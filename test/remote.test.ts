import { describe, expect, it } from "vitest";
import { buildSurfaces, emptyLedger, pin, withdraw } from "../src/core";
import { fetchLive } from "../src/deploy/live";
import { ledgerFromLive } from "../src/remote";
import { resolveThread } from "../src/core/transclusion";
import { clock, idMaker, mustPublish, SITE } from "./helpers";

/** Serve a ledger's protocol files like a blyg would. */
function serve(files: Map<string, string>) {
	return async (url: string) => {
		const body = files.get(url.replace(SITE.origin, ""));
		return body === undefined ? { status: 404, text: "" } : { status: 200, text: body };
	};
}

describe("ledgerFromLive (existing-blyg mode)", () => {
	it("rebuilds items, versions, pins, and live text from a blyg's public files", async () => {
		const t = clock();
		const ids = idMaker();
		let r = await mustPublish(emptyLedger(), { kind: "fragment", content_md: "v1 text" }, t(), ids);
		const f = r.id;
		r = await mustPublish(r.ledger, { id: f, kind: "fragment", content_md: "v2 text", note: "edit" }, t());
		const p = pin(r.ledger, f, 1);
		if (!p.ok) throw new Error();
		r = await mustPublish(p.ledger, { kind: "thread", content_md: `# T\n\n![[${f}]]` }, t(), ids);
		const th = r.id;
		r = await mustPublish(r.ledger, { kind: "fragment", content_md: "gone" }, t(), ids);
		const w = await withdraw(r.ledger, r.id, t());
		if (!w.ok) throw new Error();

		const live = await fetchLive(SITE.origin, serve(buildSurfaces(w.ledger, SITE, "2026-09-30T00:00:00Z")));
		const view = ledgerFromLive(live);

		const frag = view.items[f];
		expect(frag.authored).toBe("fragment");
		expect(frag.versions.map((v) => [v.version, v.note, !!v.pinned])).toEqual([[1, null, true], [2, "edit", false]]);
		expect(frag.versions[1]).toMatchObject({ content_md: "v2 text", kind: "fragment" });
		expect(frag.versions[0].content_hash).toBe(""); // older text isn't public
		expect(view.items[th].authored).toBe("thread");
		expect(view.items[th].versions[0].transclusions).toEqual([{ id: f, version: 2 }]);
		const gone = view.items[r.id];
		expect(gone.authored).toBe("fragment");
		expect(gone.versions.at(-1)!.kind).toBe("withdrawn");

		// The preview can resolve embeds against it, just like against a local ledger.
		expect(resolveThread(`![[${f}]]`, view).transclusions).toEqual([{ id: f, version: 2 }]);
	});

	it("an unreachable or empty blyg gives an empty view", () => {
		expect(ledgerFromLive({ kind: "none" }).items).toEqual({});
		expect(ledgerFromLive({ kind: "unreachable", error: "x" }).items).toEqual({});
	});
});
