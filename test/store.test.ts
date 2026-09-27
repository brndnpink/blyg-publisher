import { describe, expect, it } from "vitest";
import { emptyLedger, pin, publish, withdraw, type Ledger } from "../src/core";
import { diffText } from "../src/diff";
import { LedgerStore, serialize, type FileAdapter } from "../src/store";
import { clock, idMaker } from "./helpers";

/** In-memory stand-in for Obsidian's vault adapter. */
class MemoryAdapter implements FileAdapter {
	files = new Map<string, string>();
	dirs = new Set<string>();
	failNextWrite = false;
	async exists(p: string) {
		return this.files.has(p) || this.dirs.has(p);
	}
	async read(p: string) {
		const v = this.files.get(p);
		if (v === undefined) throw new Error(`no file ${p}`);
		return v;
	}
	async write(p: string, d: string) {
		this.files.set(p, this.failNextWrite ? d.slice(0, 10) : d);
		this.failNextWrite = false;
	}
	async mkdir(p: string) {
		this.dirs.add(p);
	}
	async list(p: string) {
		const files = [...this.files.keys()].filter((f) => f.startsWith(`${p}/`) && !f.slice(p.length + 1).includes("/"));
		const folders = [...this.dirs].filter((f) => f.startsWith(`${p}/`) && !f.slice(p.length + 1).includes("/"));
		return { files, folders };
	}
	async remove(p: string) {
		this.files.delete(p);
	}
}

function setup() {
	const adapter = new MemoryAdapter();
	let t = Date.parse("2026-09-27T12:00:00Z");
	const store = new LedgerStore(adapter, "Blyg/.blyg", () => new Date((t += 1000)));
	return { adapter, store, t: clock(), ids: idMaker() };
}

describe("LedgerStore", () => {
	it("starts empty and saves a published item", async () => {
		const { adapter, store, t, ids } = setup();
		expect(await store.load()).toEqual(emptyLedger());
		const r = await store.update((l) => publish(l, { kind: "fragment", content_md: "hello" }, t(), ids));
		expect(r.ok).toBe(true);
		const saved = JSON.parse(adapter.files.get("Blyg/.blyg/ledger.json")!) as Ledger;
		expect(Object.keys(saved.items)).toHaveLength(1);
	});

	it("backs up the previous ledger before every write, keeping the last 30", async () => {
		const { adapter, store, t, ids } = setup();
		const first = await store.update((l) => publish(l, { kind: "fragment", content_md: "v1" }, t(), ids));
		if (!first.ok) throw new Error();
		for (let i = 2; i <= 40; i++) {
			await store.update((l) => publish(l, { id: first.id, kind: "fragment", content_md: `v${i}` }, t()));
		}
		const { files } = await adapter.list("Blyg/.blyg/backups");
		expect(files).toHaveLength(30);
		const newest = JSON.parse(adapter.files.get(files.sort().at(-1)!)!) as Ledger;
		expect(newest.items[first.id].versions).toHaveLength(39);
	});

	it("applies operations to the freshest ledger on disk (another Mac may have published)", async () => {
		const { adapter, store, t, ids } = setup();
		// Simulate another Mac writing a ledger via Dropbox.
		const other = await publish(emptyLedger(), { kind: "fragment", content_md: "from the other Mac" }, t(), ids);
		if (!other.ok) throw new Error();
		adapter.files.set("Blyg/.blyg/ledger.json", serialize(other.ledger));
		const r = await store.update((l) => publish(l, { kind: "fragment", content_md: "from this Mac" }, t(), ids));
		if (!r.ok) throw new Error();
		expect(Object.keys((await store.load()).items)).toHaveLength(2);
	});

	it("refuses to publish while a Dropbox conflicted copy exists", async () => {
		const { adapter, store, t, ids } = setup();
		await store.update((l) => publish(l, { kind: "fragment", content_md: "x" }, t(), ids));
		adapter.files.set("Blyg/.blyg/ledger (Alex's conflicted copy 2026-09-27).json", "{}");
		const r = await store.update((l) => publish(l, { kind: "fragment", content_md: "y" }, t(), ids));
		expect(r.ok).toBe(false);
		expect(!r.ok && r.errors[0]).toMatch(/conflict/i);
		adapter.files.delete("Blyg/.blyg/ledger (Alex's conflicted copy 2026-09-27).json");
		adapter.files.set("Blyg/.blyg/ledger 2.json", "{}");
		expect((await store.conflicts()).length).toBe(1);
	});

	it("refuses an operation that would break a promise, and writes nothing", async () => {
		const { adapter, store, t, ids } = setup();
		const a = await store.update((l) => publish(l, { kind: "fragment", content_md: "x" }, t(), ids));
		if (!a.ok) throw new Error();
		await store.update((l) => pin(l, a.id, 1));
		const before = adapter.files.get("Blyg/.blyg/ledger.json");
		const r = await store.update((l) => {
			const bad = structuredClone(l);
			delete bad.items[a.id].versions[0].pinned; // an "unpin"
			return { ok: true, ledger: bad };
		});
		expect(r.ok).toBe(false);
		expect(adapter.files.get("Blyg/.blyg/ledger.json")).toBe(before);
	});

	it("refuses to load a damaged ledger", async () => {
		const { adapter, store } = setup();
		adapter.files.set("Blyg/.blyg/ledger.json", JSON.stringify({ schema: 1, items: { x: { id: "x", authored: "fragment", created: "", versions: [] } } }));
		await expect(store.load()).rejects.toThrow(/damaged/);
	});

	it("notices a write that didn't land", async () => {
		const { adapter, store, t, ids } = setup();
		adapter.failNextWrite = true;
		await expect(store.update((l) => publish(l, { kind: "fragment", content_md: "x" }, t(), ids))).rejects.toThrow(/didn't save/);
	});

	it("unchanged publishes don't touch the disk", async () => {
		const { adapter, store, t, ids } = setup();
		const a = await store.update((l) => publish(l, { kind: "fragment", content_md: "same" }, t(), ids));
		if (!a.ok) throw new Error();
		const writes = adapter.files.size;
		const b = await store.update((l) => publish(l, { id: a.id, kind: "fragment", content_md: "same" }, t()));
		expect(b.ok && b.changed).toBe(false);
		expect(adapter.files.size).toBe(writes);
	});

	it("withdrawal round-trips through the store", async () => {
		const { store, t, ids } = setup();
		const a = await store.update((l) => publish(l, { kind: "thread", content_md: "essay" }, t(), ids));
		if (!a.ok) throw new Error();
		const at = t();
		const w = await store.update((l) => withdraw(l, a.id, at));
		expect(w.ok).toBe(true);
		expect((await store.load()).items[a.id].versions.at(-1)!.kind).toBe("withdrawn");
	});
});

describe("diffText", () => {
	const render = (parts: ReturnType<typeof diffText>) =>
		parts.map((p) => (p.type === "add" ? `{+${p.text}+}` : p.type === "del" ? `[-${p.text}-]` : p.text)).join("");

	it("marks added and removed words", () => {
		expect(render(diffText("the quick fox", "the slow fox"))).toBe("the [-quick-]{+slow+} fox");
		expect(render(diffText("a", "a b"))).toBe("a{+ b+}");
	});
	it("reconstructs both sides", () => {
		const a = "One paragraph.\n\nAnother one here.";
		const b = "One paragraph, edited.\n\nAnother one.\n\nA third.";
		const parts = diffText(a, b);
		expect(parts.filter((p) => p.type !== "add").map((p) => p.text).join("")).toBe(a);
		expect(parts.filter((p) => p.type !== "del").map((p) => p.text).join("")).toBe(b);
	});
	it("falls back to lines for very long texts", () => {
		const a = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(" ");
		const b = a + " end";
		const parts = diffText(a, b);
		expect(parts.filter((p) => p.type !== "del").map((p) => p.text).join("")).toBe(b);
	});
	it("handles identical and empty input", () => {
		expect(diffText("same", "same")).toEqual([{ type: "same", text: "same" }]);
		expect(diffText("", "")).toEqual([]);
	});
});
