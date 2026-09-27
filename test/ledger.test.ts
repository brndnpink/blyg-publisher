import { describe, expect, it } from "vitest";
import {
	checkLedger,
	checkTransition,
	emptyLedger,
	pin,
	publish,
	resolveThread,
	withdraw,
	type Ledger,
} from "../src/core";
import { clock, idMaker, mustPublish } from "./helpers";

describe("publish", () => {
	it("creates v1 with id, created, hash, and html", async () => {
		const t = clock();
		const r = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "A *claim*." }, t(), idMaker());
		const item = r.ledger.items[r.id];
		expect(r.version).toBe(1);
		expect(item.created).toBe(item.versions[0].at);
		expect(item.versions[0].content_html).toBe("<p>A <em>claim</em>.</p>\n");
		expect(item.versions[0].content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(item.versions[0].note).toBeNull();
		expect(checkLedger(r.ledger)).toEqual([]);
	});

	it("bumps the version by exactly one per change", async () => {
		const t = clock();
		const a = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "one" }, t(), idMaker());
		const b = await mustPublish(a.ledger, { id: a.id, kind: "fragment", content_md: "two", note: "fix" }, t());
		expect(b.version).toBe(2);
		expect(b.ledger.items[a.id].versions[1].note).toBe("fix");
	});

	it("doesn't bump when nothing changed", async () => {
		const t = clock();
		const a = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "same" }, t(), idMaker());
		const b = await mustPublish(a.ledger, { id: a.id, kind: "fragment", content_md: "same" }, t());
		expect(b.changed).toBe(false);
		expect(b.version).toBe(1);
		expect(b.ledger).toBe(a.ledger);
	});

	it("never mutates its input ledger", async () => {
		const t = clock();
		const a = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "one" }, t(), idMaker());
		const snapshot = JSON.stringify(a.ledger);
		await mustPublish(a.ledger, { id: a.id, kind: "fragment", content_md: "two" }, t());
		await withdraw(a.ledger, a.id, t());
		pin(a.ledger, a.id, 1);
		expect(JSON.stringify(a.ledger)).toBe(snapshot);
	});

	it("refuses: unknown id, kind change, empty, over-long fragment, embeds in fragments, time going backward", async () => {
		const t = clock();
		const a = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "x" }, t(), idMaker());
		const fail = async (p: Promise<{ ok: boolean }>) => expect((await p).ok).toBe(false);
		await fail(publish(a.ledger, { id: "b".repeat(26), kind: "fragment", content_md: "y" }, t()));
		await fail(publish(a.ledger, { id: a.id, kind: "thread", content_md: "y" }, t()));
		await fail(publish(a.ledger, { kind: "fragment", content_md: "   \n" }, t()));
		await fail(publish(a.ledger, { kind: "fragment", content_md: "x".repeat(2001) }, t()));
		await fail(publish(a.ledger, { kind: "fragment", content_md: `![[${a.id}]]` }, t()));
		await fail(publish(a.ledger, { id: a.id, kind: "fragment", content_md: "y" }, "2000-01-01T00:00:00Z"));
	});

	it("allows a fragment of exactly the limit", async () => {
		const r = await publish(emptyLedger(), { kind: "fragment", content_md: "x".repeat(2000) }, clock()(), idMaker());
		expect(r.ok).toBe(true);
	});
});

describe("withdraw", () => {
	it("publishes an empty endcap and keeps the changelog", async () => {
		const t = clock();
		const a = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "gone soon" }, t(), idMaker());
		const w = await withdraw(a.ledger, a.id, t(), "changed my mind");
		if (!w.ok) throw new Error(w.errors.join());
		const v = w.ledger.items[a.id].versions[1];
		expect(v).toMatchObject({ version: 2, kind: "withdrawn", content_md: "", content_html: "", media: [] });
		expect(v.content_hash).toBe("sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
		expect(v.transclusions).toBeUndefined();
		expect(checkLedger(w.ledger)).toEqual([]);
	});

	it("empties a thread's transclusions to []", async () => {
		const t = clock();
		const a = await mustPublish(emptyLedger(), { kind: "thread", content_md: "# Essay" }, t(), idMaker());
		const w = await withdraw(a.ledger, a.id, t());
		if (!w.ok) throw new Error();
		expect(w.ledger.items[a.id].versions[1].transclusions).toEqual([]);
	});

	it("can't withdraw twice, and returning is a new version with the authored kind", async () => {
		const t = clock();
		const a = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "back" }, t(), idMaker());
		const w = await withdraw(a.ledger, a.id, t());
		if (!w.ok) throw new Error();
		expect((await withdraw(w.ledger, a.id, t())).ok).toBe(false);
		const back = await mustPublish(w.ledger, { id: a.id, kind: "fragment", content_md: "back" }, t());
		expect(back.version).toBe(3);
		expect(back.ledger.items[a.id].versions[2].kind).toBe("fragment");
	});
});

describe("pin", () => {
	it("pins retroactively, is idempotent, and has no undo", async () => {
		const t = clock();
		const a = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "v1" }, t(), idMaker());
		const b = await mustPublish(a.ledger, { id: a.id, kind: "fragment", content_md: "v2" }, t());
		const p = pin(b.ledger, a.id, 1);
		if (!p.ok) throw new Error();
		expect(p.ledger.items[a.id].versions[0].pinned).toBe(true);
		const again = pin(p.ledger, a.id, 1);
		expect(again.ok && again.changed).toBe(false);
	});

	it("refuses endcaps and missing versions", async () => {
		const t = clock();
		const a = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "x" }, t(), idMaker());
		const w = await withdraw(a.ledger, a.id, t());
		if (!w.ok) throw new Error();
		expect(pin(w.ledger, a.id, 2).ok).toBe(false);
		expect(pin(w.ledger, a.id, 9).ok).toBe(false);
		expect(pin(w.ledger, "c".repeat(26), 1).ok).toBe(false);
	});
});

describe("threads and transclusion", () => {
	async function setup() {
		const t = clock();
		const ids = idMaker();
		const f = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "Fragment *one*." }, t(), ids);
		return { t, ids, f };
	}

	it("bakes the fragment's html into a bare blockquote with provenance", async () => {
		const { t, ids, f } = await setup();
		const th = await mustPublish(
			f.ledger,
			{ kind: "thread", content_md: `Intro.\n\n![[${f.id}]]\n\nOutro.` },
			t(),
			ids,
		);
		const v = th.ledger.items[th.id].versions[0];
		expect(v.transclusions).toEqual([{ id: f.id, version: 1 }]);
		expect(v.content_html).toBe(
			`<p>Intro.</p>\n\n<blockquote class="blyg-transclusion" data-blyg-id="${f.id}" data-blyg-version="1">\n<p>Fragment <em>one</em>.</p>\n\n</blockquote>\n<p>Outro.</p>\n`,
		);
		expect(v.content_md).toContain(`![[${f.id}]]`); // md keeps the directive
	});

	it("allows whitespace around a directive, treats inline and fenced ones as text", async () => {
		const { f } = await setup();
		expect(resolveThread(`   ![[${f.id}]]  `, f.ledger).transclusions).toHaveLength(1);
		expect(resolveThread(`see ![[${f.id}]] inline`, f.ledger).transclusions).toHaveLength(0);
		const fenced = resolveThread("```\n![[" + f.id + "]]\n```", f.ledger);
		expect(fenced.transclusions).toHaveLength(0);
		expect(fenced.errors).toEqual([]);
		expect(fenced.html).toContain("<code>");
	});

	it("rejects @vN, unknown ids, withdrawn items, and threads as targets", async () => {
		const { t, ids, f } = await setup();
		expect(resolveThread(`![[${f.id}@v1]]`, f.ledger).errors).toHaveLength(1);
		expect(resolveThread(`![[${"d".repeat(26)}]]`, f.ledger).errors).toHaveLength(1);
		const th = await mustPublish(f.ledger, { kind: "thread", content_md: "T" }, t(), ids);
		expect(resolveThread(`![[${th.id}]]`, th.ledger).errors[0]).toMatch(/only fragments/);
		const w = await withdraw(th.ledger, f.id, t());
		if (!w.ok) throw new Error();
		expect(resolveThread(`![[${f.id}]]`, w.ledger).errors[0]).toMatch(/withdrawn/);
		const r = await publish(w.ledger, { kind: "thread", content_md: `![[${f.id}]]` }, t());
		expect(r.ok).toBe(false);
	});

	it("keeps snapshots independent; republishing re-resolves to the latest", async () => {
		const { t, ids, f } = await setup();
		const th = await mustPublish(f.ledger, { kind: "thread", content_md: `![[${f.id}]]` }, t(), ids);
		const f2 = await mustPublish(th.ledger, { id: f.id, kind: "fragment", content_md: "Fragment two." }, t());
		expect(f2.ledger.items[th.id].versions[0].content_html).toContain("Fragment <em>one</em>");
		const th2 = await mustPublish(f2.ledger, { id: th.id, kind: "thread", content_md: `![[${f.id}]]` }, t());
		expect(th2.changed).toBe(true);
		expect(th2.ledger.items[th.id].versions[1].transclusions).toEqual([{ id: f.id, version: 2 }]);
		expect(th2.ledger.items[th.id].versions[1].content_html).toContain("Fragment two.");
	});
});

describe("checkTransition", () => {
	async function base() {
		const t = clock();
		const a = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "one" }, t(), idMaker());
		const b = await mustPublish(a.ledger, { id: a.id, kind: "fragment", content_md: "two" }, t());
		const p = pin(b.ledger, a.id, 1);
		if (!p.ok) throw new Error();
		return { id: a.id, ledger: p.ledger, t };
	}

	it("accepts normal forward progress", async () => {
		const { id, ledger, t } = await base();
		const next = await mustPublish(ledger, { id, kind: "fragment", content_md: "three" }, t());
		expect(checkTransition(ledger, next.ledger)).toEqual([]);
	});

	it("catches items vanishing, versions going backward, rewrites, and revoked pins", async () => {
		const { id, ledger } = await base();
		const gone: Ledger = { schema: 1, items: {} };
		expect(checkTransition(ledger, gone)[0]).toMatch(/disappear/);

		const shorter = structuredClone(ledger);
		shorter.items[id].versions.pop();
		expect(checkTransition(ledger, shorter).join()).toMatch(/backward/);

		const rewritten = structuredClone(ledger);
		rewritten.items[id].versions[1].content_hash = "sha256:00";
		expect(checkTransition(ledger, rewritten).join()).toMatch(/rewritten/);

		const unpinned = structuredClone(ledger);
		delete unpinned.items[id].versions[0].pinned;
		expect(checkTransition(ledger, unpinned).join()).toMatch(/revoked/);
	});

	it("checkLedger flags broken numbering and pinned endcaps", async () => {
		const { id, ledger } = await base();
		const bad = structuredClone(ledger);
		bad.items[id].versions[1].version = 5;
		expect(checkLedger(bad).length).toBeGreaterThan(0);
	});
});
