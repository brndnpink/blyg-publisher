// "Existing blyg" mode: the blyg's server owns the items and their history.
// This turns what the blyg publishes (items/index.json plus item documents)
// into the same ledger shape the panel, checks, and previews already use.
// Only the live version's text is known; older versions show their changelog
// entry, and their text stays in the blyg's own studio.

import type { Ledger, LedgerItem, VersionRecord } from "./core/types";
import type { LiveState } from "./deploy/live";

export function ledgerFromLive(live: LiveState): Ledger {
	const ledger: Ledger = { schema: 1, items: {} };
	if (live.kind !== "live") return ledger;
	for (const entry of live.index) {
		const d = live.docs.get(entry.id);
		if (!d || (d.kind !== "fragment" && d.kind !== "thread" && d.kind !== "withdrawn")) continue;
		const authored: "fragment" | "thread" =
			d.kind === "withdrawn" ? (d.page?.startsWith("t/") || Array.isArray(d.transclusions) ? "thread" : "fragment") : d.kind;
		const versions: VersionRecord[] = d.changelog.map((c) => ({
			version: c.version,
			at: c.at ?? d.updated ?? "",
			note: c.note ?? null,
			kind: c.version === d.version ? (d.kind as VersionRecord["kind"]) : authored,
			content_md: "",
			content_html: "",
			content_hash: "", // unknown: only the live version's text is public
			media: [],
			...(c.pinned ? { pinned: true as const } : {}),
		}));
		const latest = versions.find((v) => v.version === d.version);
		if (latest) {
			latest.content_md = d.content_md ?? "";
			latest.content_html = d.content_html ?? "";
			latest.content_hash = d.content_hash;
			latest.media = d.media ?? [];
			if (authored === "thread") latest.transclusions = d.transclusions ?? [];
		}
		const item: LedgerItem = { id: d.id, authored, created: d.created ?? versions[0]?.at ?? "", versions };
		ledger.items[d.id] = item;
	}
	return ledger;
}
