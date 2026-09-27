// What's live right now, and whether deploying the ledger would break any
// promise already made in public (spec 0.2 §13.3: readers treat a version
// going backward, or the same version with different content, as a
// violation). The fetcher is injected, so this module is testable.

import { latestVersion } from "../core/ledger";
import type { Ledger } from "../core/types";

export type Getter = (url: string) => Promise<{ status: number; text: string }>;

interface LiveIndexItem {
	id: string;
	kind: string;
	version: number;
}
interface LiveDoc {
	id: string;
	version: number;
	content_hash: string;
	changelog: { version: number; pinned?: boolean }[];
}

export type LiveState =
	| { kind: "none" } // the origin answers, but there's no blyg there yet
	| { kind: "unreachable"; error: string }
	| { kind: "live"; index: LiveIndexItem[]; docs: Map<string, LiveDoc>; missingDocs: string[] };

export async function fetchLive(origin: string, get: Getter, concurrency = 6): Promise<LiveState> {
	let res;
	try {
		res = await get(`${origin}items/index.json`);
	} catch (e) {
		return { kind: "unreachable", error: (e as Error).message };
	}
	if (res.status === 404) return { kind: "none" };
	if (res.status !== 200) return { kind: "unreachable", error: `HTTP ${res.status} for items/index.json` };
	let index: LiveIndexItem[];
	try {
		index = (JSON.parse(res.text) as { items: LiveIndexItem[] }).items;
	} catch {
		return { kind: "unreachable", error: "items/index.json on the live site isn't valid JSON" };
	}

	const docs = new Map<string, LiveDoc>();
	const missingDocs: string[] = [];
	const queue = [...index];
	await Promise.all(
		Array.from({ length: concurrency }, async () => {
			for (let it = queue.shift(); it; it = queue.shift()) {
				try {
					const r = await get(`${origin}items/${it.id}.json`);
					if (r.status === 200) docs.set(it.id, JSON.parse(r.text) as LiveDoc);
					else missingDocs.push(it.id);
				} catch {
					missingDocs.push(it.id);
				}
			}
		}),
	);
	return { kind: "live", index, docs, missingDocs };
}

export interface Comparison {
	/** Anything here means deploying would break a public promise. */
	problems: string[];
	newItems: number;
	newVersions: number;
	withdrawals: number;
	newPins: number;
}

export function compareWithLive(ledger: Ledger, live: LiveState): Comparison {
	const out: Comparison = { problems: [], newItems: 0, newVersions: 0, withdrawals: 0, newPins: 0 };
	const liveIds = new Set(live.kind === "live" ? live.index.map((i) => i.id) : []);
	const livePins = new Map<string, Set<number>>();

	if (live.kind === "live") {
		for (const id of live.missingDocs) out.problems.push(`Couldn't read live item ${id}; try again in a moment.`);
		for (const it of live.index) {
			const item = ledger.items[it.id];
			if (!item) {
				out.problems.push(`Item ${it.id} is live but missing from the ledger. The ledger is out of date or was reset; restore it from a backup.`);
				continue;
			}
			const mine = latestVersion(item);
			if (mine.version < it.version) {
				out.problems.push(`Item ${it.id} is at v${it.version} online but v${mine.version} in the ledger. Deploying would roll it back; restore the newer ledger.`);
				continue;
			}
			const doc = live.docs.get(it.id);
			if (doc) {
				const same = item.versions.find((v) => v.version === doc.version);
				if (same && same.content_hash !== doc.content_hash) {
					out.problems.push(`Item ${it.id} v${doc.version} online doesn't match the ledger's v${doc.version}. Deploying would silently change published text.`);
				}
				const pins = new Set(doc.changelog.filter((c) => c.pinned).map((c) => c.version));
				livePins.set(it.id, pins);
				for (const n of pins) {
					if (!item.versions.find((v) => v.version === n)?.pinned) {
						out.problems.push(`Item ${it.id} v${n} is pinned online but not in the ledger. Pins can't be revoked; restore the newer ledger.`);
					}
				}
			}
			if (mine.version > it.version) {
				if (mine.kind === "withdrawn") out.withdrawals++;
				else out.newVersions++;
			}
		}
	}

	for (const item of Object.values(ledger.items)) {
		if (!liveIds.has(item.id)) out.newItems++;
		const already = livePins.get(item.id) ?? new Set<number>();
		out.newPins += item.versions.filter((v) => v.pinned && !already.has(v.version)).length;
	}
	return out;
}
