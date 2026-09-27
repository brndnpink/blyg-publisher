// One block per numbered security rule in the build plan.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	checkNote,
	isInPublishRoot,
	isPublishableNotePath,
	parseDenylist,
	splitFrontmatter,
	stripHidden,
	type NoteInput,
	type VaultView,
} from "../src/safety";

const FRAG_ID = "3kq9x7mvd2h0r8tn5bzfa41wce";
const THREAD_ID = "7c9wk2mhq0v3xj8tn5rzfd41bg";

/** A small fake vault. Paths are what Obsidian's link resolver would return. */
const FILES: Record<string, { id: string; kind: "fragment" | "thread" } | null> = {
	"7 - Blyg/fragments/Published fragment.md": { id: FRAG_ID, kind: "fragment" },
	"7 - Blyg/threads/Published thread.md": { id: THREAD_ID, kind: "thread" },
	"7 - Blyg/fragments/Draft fragment.md": null,
	"3 - Areas/APUSH.md": null,
	"1 - Daily/Sep 12, 2026.md": null,
	"6 - Attachments/class photo.jpg": null,
	"7 - Blyg/media/chart.png": null,
};
const vault: VaultView = {
	resolve(linkpath) {
		const want = linkpath.toLowerCase();
		return (
			Object.keys(FILES).find((p) => {
				const name = p.split("/").pop()!.toLowerCase();
				return p.toLowerCase() === want || p.toLowerCase() === `${want}.md` || name === want || name === `${want}.md`;
			}) ?? null
		);
	},
	published(path) {
		const f = FILES[path];
		return f ? { ...f, url: `https://example.com/blyg/${f.kind === "thread" ? "t" : "f"}/${f.id}/` } : null;
	},
};
const NO_TERMS = parseDenylist("");

function note(body: string, opts: Partial<NoteInput> & { kind?: string } = {}): NoteInput {
	const kind = opts.kind ?? "fragment";
	const frontmatter = opts.frontmatter ?? { blyg: "publish", blyg_kind: kind };
	const fmText = Object.entries(frontmatter)
		.map(([k, v]) => `${k}: ${String(v)}`)
		.join("\n");
	return { path: opts.path ?? `7 - Blyg/${kind}s/Test.md`, frontmatter, text: opts.text ?? `---\n${fmText}\n---\n${body}` };
}

const check = (n: NoteInput, terms = NO_TERMS) => checkNote(n, vault, terms);
const rules = (r: ReturnType<typeof check>) => r.problems.map((p) => p.rule);

describe("Rule 1: only opted-in notes inside 7 - Blyg", () => {
	it("refuses notes outside the folder, however they're marked", () => {
		for (const path of ["3 - Areas/APUSH.md", "1 - Daily/Sep 12, 2026.md", "7 - Blyg.md", "Blyg/x.md", "8 - Blyg/x.md"]) {
			const r = check(note("text", { path }));
			expect(rules(r)).toEqual([1]);
			expect(r.publicMarkdown).toBe("");
		}
	});
	it("refuses path tricks and plugin state", () => {
		expect(isInPublishRoot("7 - Blyg/../3 - Areas/APUSH.md")).toBe(false);
		expect(isInPublishRoot("7 - Blyg//x.md")).toBe(false);
		expect(isPublishableNotePath("7 - Blyg/.blyg/ledger.md")).toBe(false);
		expect(isPublishableNotePath("7 - Blyg/media/chart.png")).toBe(false);
	});
	it("requires blyg: publish and a valid kind", () => {
		expect(rules(check(note("x", { frontmatter: { blyg_kind: "fragment" } })))).toEqual([1]);
		expect(rules(check(note("x", { frontmatter: { blyg: "draft", blyg_kind: "fragment" } })))).toEqual([1]);
		expect(rules(check(note("x", { frontmatter: { blyg: "publish" } })))).toEqual([1]);
		expect(rules(check(note("x", { frontmatter: { blyg: "publish", blyg_kind: "essay" } })))).toEqual([1]);
	});
	it("refuses a hand-edited blyg_id", () => {
		const r = check(note("x", { frontmatter: { blyg: "publish", blyg_kind: "fragment", blyg_id: "not-an-id" } }));
		expect(rules(r)).toEqual([1]);
	});
	it("passes a properly marked note", () => {
		const r = check(note("A claim.", { frontmatter: { blyg: "publish", blyg_kind: "fragment", blyg_id: FRAG_ID } }));
		expect(r.problems).toEqual([]);
		expect(r).toMatchObject({ kind: "fragment", id: FRAG_ID, publicMarkdown: "A claim." });
	});
});

describe("Rule 2: embeds only of published Blyg fragments, own line, threads only", () => {
	it("turns an own-line embed of a published fragment into the protocol directive", () => {
		const r = check(note("Intro.\n\n![[Published fragment]]\n\nOutro.", { kind: "thread" }));
		expect(r.problems).toEqual([]);
		expect(r.publicMarkdown).toBe(`Intro.\n\n![[${FRAG_ID}]]\n\nOutro.`);
	});
	it("refuses embeds of private notes, unpublished notes, threads, missing notes, and partial embeds", () => {
		const cases = [
			"![[APUSH]]",
			"![[Draft fragment]]",
			"![[Published thread]]",
			"![[No such note]]",
			"![[Published fragment#Heading]]",
			"![[Published fragment|alias]]",
		];
		for (const c of cases) expect(rules(check(note(c, { kind: "thread" })))).toEqual([2]);
	});
	it("explains a link that finds a private note sharing a name with a Blyg note", () => {
		const twinVault: VaultView = { ...vault, resolve: () => "Twin.md", sameNameInRoot: () => ["7 - Blyg/fragments/Twin.md"] };
		const r = checkNote(note("![[Twin]]", { kind: "thread" }), twinVault, NO_TERMS);
		expect(r.problems[0].message).toMatch(/same name.*!\[\[7 - Blyg\/fragments\/Twin\]\]/);
		const link = checkNote(note("See [[Twin]]."), twinVault, NO_TERMS);
		expect(link.problems[0].message).toMatch(/\[\[7 - Blyg\/fragments\/Twin\]\]/);
	});
	it("accepts a full-path embed of a published fragment", () => {
		const r = check(note("![[7 - Blyg/fragments/Published fragment]]", { kind: "thread" }));
		expect(r.problems).toEqual([]);
		expect(r.publicMarkdown).toBe(`![[${FRAG_ID}]]`);
	});
	it("refuses inline embeds and any embed in a fragment", () => {
		expect(rules(check(note("see ![[Published fragment]] here", { kind: "thread" })))).toEqual([2]);
		expect(rules(check(note("![[Published fragment]]")))).toEqual([2]);
	});
	it("leaves embeds inside code alone", () => {
		const r = check(note("```\n![[APUSH]]\n```\n\nand `![[APUSH]]` inline", { kind: "thread" }));
		expect(r.problems).toEqual([]);
	});
});

describe("Rule 3: no links out of 7 - Blyg (link text can leak titles)", () => {
	it("refuses wikilinks to private, unpublished, and missing notes", () => {
		for (const l of ["[[APUSH]]", "[[Sep 12, 2026]]", "[[Draft fragment]]", "[[Nowhere]]", "[[APUSH|a harmless label]]"]) {
			expect(rules(check(note(`See ${l}.`)))).toEqual([3]);
		}
	});
	it("rewrites links to published items as ordinary web links", () => {
		const r = check(note("See [[Published thread|this essay]] and [[Published fragment]]."));
		expect(r.problems).toEqual([]);
		expect(r.publicMarkdown).toBe(
			`See [this essay](https://example.com/blyg/t/${THREAD_ID}/) and [Published fragment](https://example.com/blyg/f/${FRAG_ID}/).`,
		);
	});
	it("refuses Markdown links to vault files and obsidian:// or file:// URLs", () => {
		for (const l of ["[x](APUSH.md)", "[x](../3%20-%20Areas/APUSH.md)", "[x](obsidian://open?vault=MyVault&file=APUSH)", "[x](file:///Users/x)"]) {
			expect(rules(check(note(l)))).toEqual([3]);
		}
	});
	it("refuses reference-style link definitions and bare vault addresses", () => {
		expect(rules(check(note("See [the notes][n].\n\n[n]: ../3%20-%20Areas/APUSH.md")))).toContain(3);
		expect(rules(check(note("See [x][o].\n\n[o]: obsidian://open?vault=V&file=APUSH")))).toContain(3);
		expect(rules(check(note("Open obsidian://open?vault=MyVault&file=Grades in the app.")))).toEqual([3]);
		expect(rules(check(note("<file:///Users/me/grades.xlsx>")))).toEqual([3]);
		expect(check(note("See [docs][d].\n\n[d]: https://blygger.org/spec/")).problems).toEqual([]);
	});
	it("allows web and email links", () => {
		expect(check(note("[Blygger](https://blygger.org) and <https://x.org> and [me](mailto:a@b.co)")).problems).toEqual([]);
	});
});

describe("Rule 4: images only from 7 - Blyg/media", () => {
	it("refuses images from anywhere else", () => {
		for (const l of ["![[class photo.jpg]]", "![](../6%20-%20Attachments/class%20photo.jpg)"]) {
			const r = check(note(l, { kind: "thread" }));
			expect(rules(r)).toEqual([4]);
			expect(r.problems[0].message).toMatch(/only come from 7 - Blyg\/media/);
		}
	});
	it("holds media-folder images too until image publishing is built", () => {
		const r = check(note("![[chart.png]]", { kind: "thread" }));
		expect(rules(r)).toEqual([4]);
		expect(r.problems[0].message).toMatch(/isn't built yet/);
	});
	it("allows images hosted on the web", () => {
		expect(check(note("![a chart](https://example.org/chart.png)")).problems).toEqual([]);
	});
});

describe("Rule 5: no query blocks", () => {
	it("refuses dataview, tasks, query, and base blocks", () => {
		for (const lang of ["dataview", "dataviewjs", "query", "tasks", "base"]) {
			expect(rules(check(note("```" + lang + "\nLIST FROM \"3 - Areas\"\n```", { kind: "thread" })))).toEqual([5]);
		}
	});
	it("allows ordinary code blocks", () => {
		expect(check(note("```js\nconst x = 1;\n```", { kind: "thread" })).problems).toEqual([]);
	});
});

describe("Rule 6: sensitive-content scan flags, never edits", () => {
	const terms = parseDenylist("# private list\nAlex Example\nSpringfield\n\nJane Q Student\n");
	it("flags denylist terms case-insensitively, across line breaks, on word boundaries", () => {
		const r = check(note("Written by alex\nexample in SPRINGFIELD."), terms);
		expect(r.flags.map((f) => f.term.replace(/\s+/g, " ").toLowerCase())).toEqual(["alex example", "springfield"]);
		expect(r.publicMarkdown).toContain("alex\nexample"); // not edited
		expect(check(note("Springfieldish is not a word."), terms).flags).toEqual([]);
	});
	it("flags built-in patterns: email, phone, IEP, 504", () => {
		const r = check(note("Email me at someone@example.com or 608-555-0142. Her IEP and 504 plan."));
		expect(r.flags.map((f) => f.source)).toEqual(expect.arrayContaining(["email address", "phone number", "IEP", "504 plan"]));
	});
	it("ignores comments in the denylist file", () => {
		expect(parseDenylist("# Alex Example\n  \nx").terms).toEqual(["x"]);
	});
	it("scans only what would be published (hidden comments are already gone)", () => {
		expect(check(note("Fine. %% Jane Q Student %%"), terms).flags).toEqual([]);
	});
	it("flags are separate from problems, so publishing needs confirmation, not a fix", () => {
		const r = check(note("Springfield."), terms);
		expect(r.problems).toEqual([]);
		expect(r.flags).toHaveLength(1);
	});
});

describe("Rule 7: body only", () => {
	it("never publishes frontmatter, tags, or aliases", () => {
		const text = "---\nblyg: publish\nblyg_kind: fragment\ntags: [student-notes]\naliases: [Secret title]\n---\nThe claim.";
		const r = check(note("", { text, frontmatter: { blyg: "publish", blyg_kind: "fragment" } }));
		expect(r.publicMarkdown).toBe("The claim.");
	});
	it("splits frontmatter only when it's closed", () => {
		expect(splitFrontmatter("---\na: 1\n---\nbody")).toMatchObject({ frontmatter: "a: 1", body: "body" });
		expect(splitFrontmatter("---\nnot closed").frontmatter).toBeNull();
	});
	it("refuses a note that's empty after cleaning", () => {
		expect(rules(check(note("%% only a comment %%")))).toEqual([7]);
	});
});

describe("Rule 8: hidden comments are stripped", () => {
	it("strips %% %% and <!-- --> comments, inline and multi-line", () => {
		expect(stripHidden("A %%secret%% B").markdown).toBe("A  B");
		expect(stripHidden("A\n%%\nline one\nline two\n%%\nB").markdown).toBe("A\n\nB");
		expect(stripHidden("A <!-- hidden --> B").markdown).toBe("A  B");
		expect(stripHidden("A\n<!--\nhidden\n-->\nB").markdown).toBe("A\n\nB");
	});
	it("drops everything after an unclosed comment, as Obsidian hides it", () => {
		const r = stripHidden("Public.\n%% private from here\nstill private");
		expect(r.markdown).toBe("Public.");
		expect(r.unclosedComment).toBe(true);
		expect(check(note("Public.\n%% rest")).warnings.join()).toMatch(/never closed/);
	});
	it("leaves %% inside fenced code, where Obsidian shows it", () => {
		expect(stripHidden("```\n50%% off\n```").markdown).toBe("```\n50%% off\n```");
	});
	it("strips block ids that Obsidian hides", () => {
		expect(stripHidden("A paragraph. ^abc-123").markdown).toBe("A paragraph.");
	});
	it("the public Markdown never contains the hidden text", () => {
		const r = check(note("Visible. %% names: Jane %% <!-- grades -->"));
		expect(r.publicMarkdown).not.toMatch(/Jane|grades/);
	});
});

describe("Rule 9: image location data is stripped", () => {
	it.todo("strips EXIF and GPS data (part of the image pipeline, not built yet; images are refused until then)");
});

describe("Rule 10: preview and confirm before publishing", () => {
	it.todo("the publish window shows the exact public text and a diff, and requires Confirm: built in Phase 4 (src/modals.ts), verified by hand in Obsidian");
});

describe("Rule 11: network calls only in the deploy module", () => {
	it("no source file outside src/deploy uses a network API", () => {
		const offenders: string[] = [];
		const walk = (dir: string) => {
			for (const name of readdirSync(dir)) {
				const p = join(dir, name);
				if (statSync(p).isDirectory()) {
					if (!p.endsWith(join("src", "deploy"))) walk(p);
				} else if (/\.ts$/.test(name)) {
					const src = readFileSync(p, "utf8");
					if (/\bfetch\s*\(|requestUrl|XMLHttpRequest|WebSocket|from\s+["'](node:)?https?["']|require\(["'](node:)?https?["']\)|sendBeacon/.test(src)) {
						offenders.push(p);
					}
				}
			}
		};
		walk(join(__dirname, "..", "src"));
		expect(offenders).toEqual([]);
	});
});

describe("warnings for Obsidian-only formatting", () => {
	it("warns about single line breaks, callouts, and highlights", () => {
		const w = check(note("Line one\nline two\n\n> [!note] Callout\n\n==marked==", { kind: "thread" })).warnings.join(" ");
		expect(w).toMatch(/line breaks/);
		expect(w).toMatch(/Callouts/);
		expect(w).toMatch(/Highlights/);
	});
	it("doesn't warn about lists", () => {
		expect(check(note("- one\n- two\n- three")).warnings).toEqual([]);
	});
});
