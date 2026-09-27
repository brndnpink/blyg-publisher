// Checks our core against real documents from the two live blygs, saved in
// fixtures/live/ (gitignored: that content belongs to its authors). Skipped
// when the fixtures aren't present, e.g. on a fresh clone or in CI.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contentHash, isValidId, renderMarkdown } from "../src/core";

const DIR = join(__dirname, "..", "fixtures", "live");
const ITEMS = join(DIR, "items");
const load = (dir: string, match: RegExp) =>
	existsSync(dir)
		? readdirSync(dir)
				.filter((f) => match.test(f))
				.map((f) => ({ name: f, doc: JSON.parse(readFileSync(join(dir, f), "utf8")) }))
		: [];
const docs = [...load(DIR, /\.pinned\.json$/), ...load(ITEMS, /\.json$/)];

describe.skipIf(docs.length === 0)("live blyg documents", () => {
	it.each(docs)("$name: content_hash is sha256 of content_md", async ({ doc }) => {
		expect(await contentHash(doc.content_md)).toBe(doc.content_hash);
	});

	it.each(docs)("$name: id is valid", ({ doc }) => {
		expect(isValidId(doc.id)).toBe(true);
	});

	// Fragments with generated spans are excluded: their html carries
	// blyg-tk-gen wrappers added at generation time (§5.7), which by design
	// can't be derived from content_md.
	it.each(docs.filter((d) => d.doc.kind === "fragment" && !d.doc.generated))(
		"$name: our markdown renders their content_md to identical content_html",
		({ doc }) => {
			expect(renderMarkdown(doc.content_md)).toBe(doc.content_html);
		},
	);
});
