import { describe, expect, it } from "vitest";
import {
	absolutizeHtml,
	cdata,
	contentHash,
	excerptFromHtml,
	isValidId,
	newId,
	renderMarkdown,
	rfc822,
	toIso,
} from "../src/core";

describe("ids", () => {
	it("are 26 chars of lowercase Crockford base32", () => {
		for (let i = 0; i < 500; i++) {
			const id = newId();
			expect(id).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{26}$/);
			expect(isValidId(id)).toBe(true);
		}
	});
	it("start with 0-7, since the top two of 130 bits are zero padding", () => {
		for (let i = 0; i < 200; i++) expect("01234567").toContain(newId()[0]);
	});
	it("don't repeat", () => {
		const ids = new Set(Array.from({ length: 2000 }, newId));
		expect(ids.size).toBe(2000);
	});
	it("rejects excluded letters and wrong lengths", () => {
		expect(isValidId("i".repeat(26))).toBe(false);
		expect(isValidId("a".repeat(25))).toBe(false);
		expect(isValidId("A".repeat(26))).toBe(false);
	});
});

describe("contentHash", () => {
	it("matches the spec's example (sha256 of 'test')", async () => {
		expect(await contentHash("test")).toBe(
			"sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
		);
	});
	it("hashes the empty string like a withdrawal endcap on the live nodes", async () => {
		expect(await contentHash("")).toBe(
			"sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});
	it("hashes UTF-8", async () => {
		expect(await contentHash("é")).not.toBe(await contentHash("e"));
	});
});

describe("dates", () => {
	it("formats ISO at second precision", () => {
		expect(toIso(new Date("2026-09-27T16:04:44.123Z"))).toBe("2026-09-27T16:04:44Z");
	});
	it("formats RFC 822 for RSS", () => {
		expect(rfc822("2026-07-18T09:30:00Z")).toBe("Sat, 18 Jul 2026 09:30:00 GMT");
	});
});

describe("escaping", () => {
	it("splits ]]> inside CDATA", () => {
		expect(cdata("a]]>b")).toBe("<![CDATA[a]]]]><![CDATA[>b]]>");
	});
	it("absolutizes relative and root-relative URLs only", () => {
		const o = "https://example.com/blyg/";
		expect(absolutizeHtml('<img src="media/x.png">', o)).toBe('<img src="https://example.com/blyg/media/x.png">');
		expect(absolutizeHtml('<a href="/about">', o)).toBe('<a href="https://example.com/about">');
		expect(absolutizeHtml('<a href="https://other.org/">', o)).toBe('<a href="https://other.org/">');
		expect(absolutizeHtml('<a href="#n1">', o)).toBe('<a href="#n1">');
		expect(absolutizeHtml('<a href="mailto:x@y.z">', o)).toBe('<a href="mailto:x@y.z">');
	});
});

describe("markdown", () => {
	it("escapes raw HTML instead of passing it through", () => {
		expect(renderMarkdown("<script>alert(1)</script>")).toContain("&lt;script&gt;");
	});
	it("linkifies bare URLs", () => {
		expect(renderMarkdown("see https://blygger.org")).toContain('<a href="https://blygger.org">');
	});
	it("excerpts without welding paragraphs together", () => {
		expect(excerptFromHtml("<p>One.</p><p>Two.</p>")).toBe("One. Two.");
		expect(excerptFromHtml(`<p>${"word ".repeat(30)}</p>`, 20)).toBe("word word word word…");
	});
});
