import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSurfaces, emptyLedger, pin, withdraw, type Ledger } from "../src/core";
import { compareWithLive, fetchLive, type Getter } from "../src/deploy/live";
import { MARKER, writeSite } from "../src/deploy/output";
import { uploadCommand } from "../src/deploy/upload";
import { buildSite } from "../src/site/build";
import { itemTitle } from "../src/site/pages";
import { clock, idMaker, mustPublish, SITE } from "./helpers";

const NOW = "2026-09-30T00:00:00Z";
const HOME = { intro: "Hello.", links: [{ label: "Newsletter", url: "https://example.org/news" }] };

async function sample() {
	const t = clock();
	const ids = idMaker();
	let r = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "Quote > me: a *fragment*.\n\n> with its own quote" }, t(), ids);
	const f1 = r.id;
	r = await mustPublish(r.ledger, { kind: "thread", content_md: `# The Essay Title\n\nIntro.\n\n![[${f1}]]\n\nEnd.` }, t(), ids);
	const th = r.id;
	r = await mustPublish(r.ledger, { id: th, kind: "thread", content_md: `# The Essay Title\n\nIntro, revised.\n\n![[${f1}]]\n\nEnd.`, note: "revised" }, t());
	const p = pin(r.ledger, th, 1);
	if (!p.ok) throw new Error();
	r = await mustPublish(p.ledger, { kind: "fragment", content_md: "Going away soon." }, t(), ids);
	const gone = r.id;
	const w = await withdraw(r.ledger, gone, t(), "retracted");
	if (!w.ok) throw new Error();
	return { ledger: w.ledger, f1, th, gone };
}

describe("buildSite", () => {
	it("puts protocol files and pages under the mount, with home, 404, and headers at the root", async () => {
		const { ledger, f1, th, gone } = await sample();
		const files = buildSite(ledger, SITE, HOME, NOW);
		for (const path of [
			"blyg/blyg.json", "blyg/feed.xml", "blyg/items/index.json", `blyg/items/${th}/v1.json`,
			"blyg/index.html", "blyg/style.css",
			`blyg/f/${f1}/index.html`, `blyg/t/${th}/index.html`, `blyg/t/${th}/v1/index.html`, `blyg/f/${gone}/index.html`,
			"index.html", "404.html", "_headers",
		]) {
			expect(files.has(path), path).toBe(true);
		}
		expect(files.has(`blyg/t/${th}/v2/index.html`)).toBe(false); // unpinned history never gets a page
	});

	it("protocol files are byte-identical to the core's output", async () => {
		const { ledger } = await sample();
		const files = buildSite(ledger, SITE, HOME, NOW);
		for (const [path, body] of buildSurfaces(ledger, SITE, NOW)) expect(files.get(`blyg/${path}`)).toBe(body);
	});

	it("serves CORS on the blyg and a real 404 page (so unknown items don't return 200)", async () => {
		const files = buildSite((await sample()).ledger, SITE, HOME, NOW);
		expect(files.get("_headers")).toMatch(/^\/blyg\/\*\n {2}Access-Control-Allow-Origin: \*/);
		expect(files.get("404.html")).toContain("nothing at this address");
	});

	it("the list page shows live items only, threads by title", async () => {
		const { ledger, th, gone } = await sample();
		const list = buildSite(ledger, SITE, HOME, NOW).get("blyg/index.html")!;
		expect(list).toContain(`href="/blyg/t/${th}/">The Essay Title</a>`);
		expect(list).not.toContain(gone);
		expect(list).toContain("v2 · updated");
		expect(list).not.toMatch(/<script/i);
	});

	it("thread pages add provenance around the exact baked blockquote, even when the fragment has its own quote", async () => {
		const { ledger, f1, th } = await sample();
		const page = buildSite(ledger, SITE, HOME, NOW).get(`blyg/t/${th}/index.html`)!;
		expect(page).toContain(`↳ <a href="/blyg/f/${f1}/">fragment</a> · v1`);
		expect(page.match(/tc-source/g)).toHaveLength(1);
		// the baked content_html itself is untouched in the item document
		const doc = JSON.parse(buildSite(ledger, SITE, HOME, NOW).get(`blyg/items/${th}.json`)!);
		expect(doc.content_html).not.toContain("tc-source");
	});

	it("thread pages show the current version and link only to pinned history", async () => {
		const { ledger, th } = await sample();
		const page = buildSite(ledger, SITE, HOME, NOW).get(`blyg/t/${th}/index.html`)!;
		expect(page).toContain("Intro, revised.");
		expect(page).toContain(`◆ pinned: <a href="/blyg/t/${th}/v1/">v1</a>`);
		expect(page).not.toContain(`/t/${th}/v2/`);
	});

	it("pinned pages carry that version verbatim, marked frozen, canonical to the live page", async () => {
		const { ledger, th } = await sample();
		const page = buildSite(ledger, SITE, HOME, NOW).get(`blyg/t/${th}/v1/index.html`)!;
		const v1 = ledger.items[th].versions[0];
		expect(page).toContain(v1.content_html);
		expect(page).toContain("Frozen copy");
		expect(page).toContain(`<link rel="canonical" href="https://example.com/blyg/t/${th}/">`);
		expect(page).toContain(`/blyg/items/${th}/v1.json`);
	});

	it("withdrawn items keep a page that says so, without the old text", async () => {
		const { ledger, gone } = await sample();
		const page = buildSite(ledger, SITE, HOME, NOW).get(`blyg/f/${gone}/index.html`)!;
		expect(page).toContain("withdrew this fragment");
		expect(page).toContain("retracted");
		expect(page).not.toContain("Going away soon.");
	});

	it("home page links the blyg and configured links; every page advertises the feed and rel=blyg", async () => {
		const files = buildSite((await sample()).ledger, SITE, HOME, NOW);
		const home = files.get("index.html")!;
		expect(home).toContain('<a href="/blyg/">blyg</a>');
		expect(home).toContain("https://example.org/news");
		for (const [path, body] of files) {
			if (path.endsWith(".html")) {
				expect(body, path).toContain('<link rel="blyg" href="/blyg/">');
				expect(body, path).toContain('type="application/rss+xml"');
			}
		}
	});

	it("a root-mounted blyg has no separate home page", () => {
		const files = buildSite(emptyLedger(), { ...SITE, origin: "https://example.com/" }, HOME, NOW);
		expect(files.has("blyg.json")).toBe(true);
		expect(files.get("index.html")).toContain("Nothing published yet");
	});

	it("titles: a thread's leading heading, else an excerpt", async () => {
		const { ledger, th, f1 } = await sample();
		expect(itemTitle(ledger.items[th])).toBe("The Essay Title");
		expect(itemTitle(ledger.items[f1])).toMatch(/^Quote > me: a fragment\./);
	});
});

describe("compareWithLive", () => {
	async function liveFrom(ledger: Ledger): Promise<Getter> {
		const files = buildSurfaces(ledger, SITE, NOW);
		return async (url) => {
			const path = url.replace(SITE.origin, "");
			const body = files.get(path);
			return body === undefined ? { status: 404, text: "" } : { status: 200, text: body };
		};
	}

	it("first deploy: nothing live", async () => {
		const { ledger } = await sample();
		const live = await fetchLive(SITE.origin, async () => ({ status: 404, text: "" }));
		expect(live.kind).toBe("none");
		const c = compareWithLive(ledger, live);
		expect(c.problems).toEqual([]);
		expect(c.newItems).toBe(3);
		expect(c.newPins).toBe(1);
	});

	it("unreachable is reported, not treated as empty", async () => {
		const live = await fetchLive(SITE.origin, async () => {
			throw new Error("getaddrinfo ENOTFOUND");
		});
		expect(live).toMatchObject({ kind: "unreachable" });
	});

	it("normal forward progress passes and is summarized", async () => {
		const { ledger, f1 } = await sample();
		const live = await fetchLive(SITE.origin, await liveFrom(ledger));
		const next = await mustPublish(ledger, { id: f1, kind: "fragment", content_md: "Edited." }, clock("2026-09-02T00:00:00Z")());
		const c = compareWithLive(next.ledger, live);
		expect(c.problems).toEqual([]);
		expect(c).toMatchObject({ newItems: 0, newVersions: 1, newPins: 0 });
	});

	it("refuses to roll back: an older ledger, a missing item, a rewritten version, or a dropped pin", async () => {
		const { ledger, f1, th } = await sample();
		const live = await fetchLive(SITE.origin, await liveFrom(ledger));

		const older = structuredClone(ledger);
		older.items[th].versions.pop();
		expect(compareWithLive(older, live).problems.join()).toMatch(/roll it back/);

		const missing = structuredClone(ledger);
		delete missing.items[f1];
		expect(compareWithLive(missing, live).problems.join()).toMatch(/missing from the ledger/);

		const rewritten = structuredClone(ledger);
		rewritten.items[f1].versions[0].content_hash = "sha256:00";
		expect(compareWithLive(rewritten, live).problems.join()).toMatch(/silently change/);

		const unpinned = structuredClone(ledger);
		delete unpinned.items[th].versions[0].pinned;
		expect(compareWithLive(unpinned, live).problems.join()).toMatch(/pinned online/);
	});
});

describe("output folder", () => {
	it("writes the site, and rebuilds cleanly into its own folder", () => {
		const base = mkdtempSync(join(tmpdir(), "blyg-test-"));
		const dir = join(base, "site");
		writeSite(new Map([["a/b.html", "x"], ["c.txt", "y"]]), dir);
		expect(readFileSync(join(dir, "a/b.html"), "utf8")).toBe("x");
		writeSite(new Map([["d.txt", "z"]]), dir);
		expect(readdirSync(dir).sort()).toEqual([MARKER, "d.txt"].sort());
	});

	it("refuses to clear a folder it didn't create", () => {
		const base = mkdtempSync(join(tmpdir(), "blyg-test-"));
		const dir = join(base, "precious");
		mkdirSync(dir);
		writeFileSync(join(dir, "thesis.docx"), "important");
		expect(() => writeSite(new Map([["x", "y"]]), dir)).toThrow(/didn't create/);
		expect(existsSync(join(dir, "thesis.docx"))).toBe(true);
	});

	it("refuses shallow paths and path traversal", () => {
		expect(() => writeSite(new Map(), "/Users")).toThrow(/dedicated folder/);
		const dir = join(mkdtempSync(join(tmpdir(), "blyg-test-")), "site");
		expect(() => writeSite(new Map([["../escape.txt", "x"]]), dir)).toThrow(/outside/);
	});
});

describe("upload command", () => {
	it("quotes paths and validates the project name", () => {
		expect(uploadCommand("/tmp/my site's", "my-site")).toBe(
			"npx --yes wrangler@4 pages deploy '/tmp/my site'\\''s' --project-name 'my-site' --branch main --commit-dirty=true",
		);
		expect(() => uploadCommand("/tmp/x", "My Site; rm -rf ~")).toThrow(/valid/);
	});
});
