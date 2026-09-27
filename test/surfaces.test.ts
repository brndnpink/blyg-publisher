import { XMLParser, XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { buildSurfaces, emptyLedger, pin, validateSite, withdraw, type Ledger } from "../src/core";
import { clock, idMaker, mustPublish, SITE } from "./helpers";

const NOW = "2026-09-30T00:00:00Z";

/** Field order observed in live item documents from the reference client (0.3 adds only `page`). */
const ITEM_KEYS = [
	"blyg", "id", "kind", "origin", "page", "author", "created", "updated", "version",
	"content_md", "content_html", "content_hash", "media",
];
const PINNED_KEYS = [
	"blyg", "id", "kind", "version", "at", "note", "pinned", "origin", "author",
	"content_md", "content_html", "content_hash",
];

async function sample() {
	const t = clock();
	const ids = idMaker();
	let r = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "First fragment." }, t(), ids);
	const f1 = r.id;
	r = await mustPublish(r.ledger, { kind: "fragment", content_md: "Second & <fragment>." }, t(), ids);
	const f2 = r.id;
	r = await mustPublish(r.ledger, { kind: "thread", content_md: `# Essay\n\n![[${f1}]]\n\nClosing.` }, t(), ids);
	const th = r.id;
	r = await mustPublish(r.ledger, { id: f1, kind: "fragment", content_md: "First fragment, revised.", note: "sharpened" }, t());
	const p = pin(r.ledger, f1, 1);
	if (!p.ok) throw new Error();
	const w = await withdraw(p.ledger, f2, t(), "retracted");
	if (!w.ok) throw new Error();
	return { ledger: w.ledger, f1, f2, th, t };
}

const json = (files: Map<string, string>, path: string) => JSON.parse(files.get(path)!);

describe("buildSurfaces", () => {
	it("emits exactly the protocol files, with pinned versions only when pinned", async () => {
		const { ledger, f1, f2, th } = await sample();
		const files = buildSurfaces(ledger, SITE, NOW);
		expect([...files.keys()].sort()).toEqual(
			[
				"blyg.json",
				"feed.xml",
				"items/index.json",
				`items/${f1}.json`,
				`items/${f1}/v1.json`,
				`items/${f2}.json`,
				`items/${th}.json`,
			].sort(),
		);
	});

	it("item documents match the live field order and serve only the latest content", async () => {
		const { ledger, f1, th } = await sample();
		const files = buildSurfaces(ledger, SITE, NOW);
		const frag = json(files, `items/${f1}.json`);
		expect(Object.keys(frag)).toEqual([...ITEM_KEYS, "changelog"]);
		expect(frag).toMatchObject({ blyg: "0.2", kind: "fragment", version: 2, page: `f/${f1}/`, content_md: "First fragment, revised." });
		expect(frag.updated).toBe(frag.changelog.at(-1).at);
		expect(frag.changelog).toEqual([
			{ version: 1, at: frag.created, note: null, pinned: true },
			{ version: 2, at: frag.updated, note: "sharpened" },
		]);
		expect(frag.author).toEqual({ name: "Test Author", url: SITE.origin });

		const thread = json(files, `items/${th}.json`);
		expect(Object.keys(thread)).toEqual([...ITEM_KEYS, "transclusions", "changelog"]);
		expect(thread.page).toBe(`t/${th}/`);
		// snapshot independence: the thread still carries fragment v1
		expect(thread.transclusions).toEqual([{ id: f1, version: 1 }]);
		expect(thread.content_html).toContain("First fragment.");
	});

	it("withdrawn items keep 200-forever documents with empty content", async () => {
		const { ledger, f2 } = await sample();
		const doc = json(buildSurfaces(ledger, SITE, NOW), `items/${f2}.json`);
		expect(doc).toMatchObject({ kind: "withdrawn", version: 2, content_md: "", content_html: "", media: [] });
		expect(doc.transclusions).toBeUndefined(); // it was a fragment
		expect(doc.page).toBe(`f/${f2}/`);
		expect(doc.changelog[1].note).toBe("retracted");
	});

	it("pinned documents carry that version's own content", async () => {
		const { ledger, f1 } = await sample();
		const pinned = json(buildSurfaces(ledger, SITE, NOW), `items/${f1}/v1.json`);
		expect(Object.keys(pinned)).toEqual(PINNED_KEYS);
		expect(pinned).toMatchObject({ version: 1, pinned: true, kind: "fragment", content_md: "First fragment." });
	});

	it("pins survive withdrawal", async () => {
		const { ledger, f1, t } = await sample();
		const w = await withdraw(ledger, f1, t());
		if (!w.ok) throw new Error();
		expect(buildSurfaces(w.ledger, SITE, NOW).has(`items/${f1}/v1.json`)).toBe(true);
	});

	it("archive index lists everything newest-first; manifest points at the surfaces", async () => {
		const { ledger, f2 } = await sample();
		const files = buildSurfaces(ledger, SITE, NOW);
		const index = json(files, "items/index.json");
		expect(index.items).toHaveLength(3);
		expect(index.items[0]).toMatchObject({ id: f2, kind: "withdrawn", version: 2 });
		const updated = index.items.map((i: { updated: string }) => i.updated);
		expect([...updated].sort().reverse()).toEqual(updated);
		const manifest = json(files, "blyg.json");
		expect(manifest).toMatchObject({
			blyg: "0.2", level: 1, site: SITE.origin, feed: "feed.xml", items: "items/index.json", updated: index.updated,
		});
		expect(manifest.blogroll).toBeUndefined();
	});

	it("an empty blyg is still valid", () => {
		const files = buildSurfaces(emptyLedger(), SITE, NOW);
		expect(json(files, "items/index.json")).toEqual({ updated: NOW, items: [] });
		expect(XMLValidator.validate(files.get("feed.xml")!)).toBe(true);
	});

	it("is deterministic", async () => {
		const { ledger } = await sample();
		const a = buildSurfaces(ledger, SITE, NOW);
		const b = buildSurfaces(structuredClone(ledger), SITE, NOW);
		expect([...a.entries()]).toEqual([...b.entries()]);
	});

	it("rejects a bad site config", () => {
		expect(validateSite({ ...SITE, origin: "https://example.com/blyg" })).not.toEqual([]);
		expect(validateSite({ ...SITE, origin: "http://example.com/" })).not.toEqual([]);
		expect(() => buildSurfaces(emptyLedger(), { ...SITE, title: " " }, NOW)).toThrow();
	});
});

describe("feed.xml", () => {
	async function parsed(ledger: Ledger) {
		const xml = buildSurfaces(ledger, SITE, NOW).get("feed.xml")!;
		expect(XMLValidator.validate(xml)).toBe(true);
		const doc = new XMLParser({ ignoreAttributes: false }).parse(xml);
		const items = doc.rss.channel.item;
		return { xml, doc, items: Array.isArray(items) ? items : items ? [items] : [] };
	}

	it("has the namespace, level, and manifest hook", async () => {
		const { ledger } = await sample();
		const { doc } = await parsed(ledger);
		expect(doc.rss["@_xmlns:blyg"]).toBe("https://blygger.org/ns/0.1");
		expect(doc.rss.channel["blyg:manifest"]).toBe(`${SITE.origin}blyg.json`);
		expect(doc.rss.channel["blyg:level"]).toBe(1);
	});

	it("has one entry per publish event with per-version GUIDs, newest first", async () => {
		const { ledger, f1, th } = await sample();
		const { items } = await parsed(ledger);
		const guids = items.map((i: { guid: { "#text": string } }) => i.guid["#text"]);
		// f2 was withdrawn: only its endcap survives. Pinning emits nothing.
		expect(guids).toEqual([
			expect.stringMatching(/^blyg:\w{26}:v2$/), // f2 withdrawal
			`blyg:${f1}:v2`,
			`blyg:${th}:v1`,
			`blyg:${f1}:v1`,
		]);
	});

	it("older events render the latest content, never history", async () => {
		const { ledger, f1 } = await sample();
		const { items } = await parsed(ledger);
		const oldEvent = items.find((i: { guid: { "#text": string } }) => i.guid["#text"] === `blyg:${f1}:v1`);
		expect(oldEvent.description).toContain("First fragment, revised.");
		expect(oldEvent.description).not.toContain("<p>First fragment.</p>");
		expect(oldEvent["blyg:version"]).toBe(1);
	});

	it("withdrawn items contribute one entry titled 'withdrawn' with an empty description", async () => {
		const { ledger, f2 } = await sample();
		const { items, xml } = await parsed(ledger);
		const entries = items.filter((i: Record<string, unknown>) => i["blyg:id"] === f2);
		expect(entries).toHaveLength(1);
		expect(entries[0].title).toBe("withdrawn");
		expect(entries[0]["blyg:kind"]).toBe("withdrawn");
		expect(xml).not.toContain("Second &amp; &lt;fragment&gt;");
	});

	it("titles combine the note and an excerpt; bylines use dc:creator", async () => {
		const { ledger, f1 } = await sample();
		const { items } = await parsed(ledger);
		const e = items.find((i: { guid: { "#text": string } }) => i.guid["#text"] === `blyg:${f1}:v2`);
		expect(e.title).toBe("sharpened — First fragment, revised.");
		expect(e["dc:creator"]).toBe("Test Author");
		expect(e.link).toBe(`${SITE.origin}f/${f1}/`);
	});

	it("keeps the window to 50 entries", async () => {
		const t = clock();
		let r = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "v1" }, t(), idMaker());
		for (let i = 2; i <= 60; i++) r = await mustPublish(r.ledger, { id: r.id, kind: "fragment", content_md: `v${i}` }, t());
		const { items } = await parsed(r.ledger);
		expect(items).toHaveLength(50);
		expect(items[0]["blyg:version"]).toBe(60);
	});

	it("makes media URLs absolute", async () => {
		const r = await mustPublish(
			emptyLedger(),
			{ kind: "fragment", content_md: "pic", media: [{ url: "media/a1.png", mime: "image/png", alt: "a chart" }] },
			clock()(),
			idMaker(),
		);
		const { xml } = await parsed(r.ledger);
		expect(xml).toContain(`<img src="${SITE.origin}media/a1.png" alt="a chart">`);
	});
});

describe("titles in published files", () => {
	it("item and pinned documents carry an extra title member; the feed uses it", async () => {
		const t = clock();
		const r = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "A claim.", title: "On contingency" }, t(), idMaker());
		const p = pin(r.ledger, r.id, 1);
		if (!p.ok) throw new Error();
		const files = buildSurfaces(p.ledger, SITE, NOW);
		const doc = json(files, `items/${r.id}.json`);
		expect(doc.title).toBe("On contingency");
		expect(Object.keys(doc).indexOf("title")).toBe(Object.keys(doc).indexOf("page") + 1);
		expect(doc.content_md).toBe("A claim.");
		expect(json(files, `items/${r.id}/v1.json`).title).toBe("On contingency");
		expect(files.get("feed.xml")).toContain("<title>On contingency</title>");
	});
	it("a title change alone is a new version", async () => {
		const t = clock();
		const a = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "Same text." }, t(), idMaker());
		const b = await mustPublish(a.ledger, { id: a.id, kind: "fragment", content_md: "Same text.", title: "Now titled" }, t());
		expect(b.changed).toBe(true);
		expect(b.version).toBe(2);
	});
	it("withdrawn items don't keep their title", async () => {
		const t = clock();
		const a = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "x", title: "Gone" }, t(), idMaker());
		const w = await withdraw(a.ledger, a.id, t());
		if (!w.ok) throw new Error();
		expect(json(buildSurfaces(w.ledger, SITE, NOW), `items/${a.id}.json`).title).toBeUndefined();
	});
});
