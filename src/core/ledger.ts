// The ledger: the private record of every item, version, and pin.
// Every operation is pure: it returns a new ledger or a list of errors and
// never mutates its input. The publish-side rules of spec 0.2 §§5, 8, 9 live here.

import { renderMarkdown } from "./markdown";
import { hasDirectives, resolveThread } from "./transclusion";
import type {
	AuthoredKind,
	Generated,
	Ledger,
	LedgerItem,
	Media,
	Result,
	Transclusion,
	VersionRecord,
} from "./types";
import { FRAGMENT_MAX_CHARS, TITLE_MAX_CHARS } from "./types";
import { contentHash, isValidId, newId } from "./util";

export function emptyLedger(): Ledger {
	return { schema: 1, items: {} };
}

export function latestVersion(item: LedgerItem): VersionRecord {
	const v = item.versions.at(-1);
	if (!v) throw new Error(`ledger item ${item.id} has no versions`);
	return v;
}

export interface PublishInput {
	/** Omit for a new item; pass the existing id to publish a new version. */
	id?: string;
	kind: AuthoredKind;
	content_md: string;
	note?: string | null;
	media?: Media[];
	generated?: Generated[];
	title?: string;
}

export interface PublishOk {
	ledger: Ledger;
	id: string;
	/** False when nothing changed since the latest version; the ledger is returned unchanged. */
	changed: boolean;
	version: number;
}

/**
 * Publish a new item or a new version of an existing one. `at` is the publish
 * time (ISO 8601 UTC); `makeId` exists so tests can be deterministic.
 */
export async function publish(
	ledger: Ledger,
	input: PublishInput,
	at: string,
	makeId: () => string = newId,
): Promise<Result<PublishOk>> {
	const errors: string[] = [];
	const existing = input.id !== undefined ? ledger.items[input.id] : undefined;

	if (input.id !== undefined && !existing) {
		errors.push(
			`id ${input.id} is not in the ledger. The ledger may be out of date; restore it before publishing.`,
		);
	}
	if (existing && existing.authored !== input.kind) {
		errors.push(`item ${existing.id} is a ${existing.authored}; an item can't change kind`);
	}
	if (existing && at < latestVersion(existing).at) {
		errors.push(`publish time ${at} is earlier than the last publish (${latestVersion(existing).at})`);
	}
	if (input.content_md.trim() === "") {
		errors.push("content is empty");
	}
	const title = input.title?.replace(/\s+/g, " ").trim() || undefined;
	if (title && title.length > TITLE_MAX_CHARS) {
		errors.push(`title is ${title.length} characters; the limit is ${TITLE_MAX_CHARS}`);
	}

	let content_html = "";
	let transclusions: Transclusion[] | undefined;
	if (input.kind === "fragment") {
		if (input.content_md.length > FRAGMENT_MAX_CHARS) {
			errors.push(
				`fragment is ${input.content_md.length} characters; the limit is ${FRAGMENT_MAX_CHARS}. Make it a thread.`,
			);
		}
		if (hasDirectives(input.content_md)) {
			errors.push("fragments can't embed other items; make it a thread");
		}
		content_html = renderMarkdown(input.content_md);
	} else {
		const resolved = resolveThread(input.content_md, ledger);
		errors.push(...resolved.errors);
		content_html = resolved.html;
		transclusions = resolved.transclusions;
	}
	if (errors.length) return { ok: false, errors };

	const content_hash = await contentHash(input.content_md);
	const media = input.media ?? [];

	if (existing) {
		const prev = latestVersion(existing);
		const same =
			prev.kind === input.kind &&
			prev.content_hash === content_hash &&
			prev.content_html === content_html &&
			JSON.stringify(prev.media) === JSON.stringify(media) &&
			JSON.stringify(prev.transclusions) === JSON.stringify(transclusions) &&
			JSON.stringify(prev.generated) === JSON.stringify(input.generated) &&
			prev.title === title;
		if (same) return { ok: true, ledger, id: existing.id, changed: false, version: prev.version };
	}

	const id = existing?.id ?? makeId();
	if (!isValidId(id)) return { ok: false, errors: [`generated id ${id} is invalid`] };
	if (!existing && ledger.items[id]) return { ok: false, errors: [`id collision: ${id}`] };

	const record: VersionRecord = {
		version: existing ? latestVersion(existing).version + 1 : 1,
		at,
		note: input.note ?? null,
		kind: input.kind,
		content_md: input.content_md,
		content_html,
		content_hash,
		media,
		...(transclusions !== undefined ? { transclusions } : {}),
		...(input.generated?.length ? { generated: input.generated } : {}),
		...(title ? { title } : {}),
	};

	const next = structuredClone(ledger);
	if (existing) {
		next.items[id].versions.push(record);
	} else {
		next.items[id] = { id, authored: input.kind, created: at, versions: [record] };
	}
	return { ok: true, ledger: next, id, changed: true, version: record.version };
}

/** Withdraw an item: publish the permanent, reversible endcap (§9). */
export async function withdraw(
	ledger: Ledger,
	id: string,
	at: string,
	note: string | null = null,
): Promise<Result<{ ledger: Ledger; version: number }>> {
	const item = ledger.items[id];
	if (!item) return { ok: false, errors: [`no item with id ${id}`] };
	const prev = latestVersion(item);
	if (prev.kind === "withdrawn") return { ok: false, errors: [`item ${id} is already withdrawn`] };
	if (at < prev.at) return { ok: false, errors: [`withdrawal time ${at} is earlier than the last publish`] };

	const record: VersionRecord = {
		version: prev.version + 1,
		at,
		note,
		kind: "withdrawn",
		content_md: "",
		content_html: "",
		content_hash: await contentHash(""),
		media: [],
		...(item.authored === "thread" ? { transclusions: [] } : {}),
	};
	const next = structuredClone(ledger);
	next.items[id].versions.push(record);
	return { ok: true, ledger: next, version: record.version };
}

/**
 * Pin a version: an irrevocable promise to serve it forever (§8). There is
 * deliberately no unpin. Pinning an already-pinned version is a no-op.
 */
export function pin(ledger: Ledger, id: string, version: number): Result<{ ledger: Ledger; changed: boolean }> {
	const item = ledger.items[id];
	if (!item) return { ok: false, errors: [`no item with id ${id}`] };
	const record = item.versions.find((v) => v.version === version);
	if (!record) return { ok: false, errors: [`item ${id} has no version ${version}`] };
	if (record.kind === "withdrawn") return { ok: false, errors: ["a withdrawal endcap can't be pinned"] };
	if (record.pinned) return { ok: true, ledger, changed: false };

	const next = structuredClone(ledger);
	const target = next.items[id].versions.find((v) => v.version === version)!;
	target.pinned = true;
	return { ok: true, ledger: next, changed: true };
}

/**
 * Internal consistency of one ledger: versions numbered 1..n in order,
 * non-decreasing times, fixed authored kind, well-formed ids.
 */
export function checkLedger(ledger: Ledger): string[] {
	const problems: string[] = [];
	if (ledger.schema !== 1) problems.push(`unknown ledger schema ${String(ledger.schema)}`);
	for (const [key, item] of Object.entries(ledger.items)) {
		if (key !== item.id) problems.push(`item key ${key} doesn't match id ${item.id}`);
		if (!isValidId(item.id)) problems.push(`invalid id ${item.id}`);
		if (!item.versions.length) problems.push(`${item.id}: no versions`);
		item.versions.forEach((v, i) => {
			if (v.version !== i + 1) problems.push(`${item.id}: version ${v.version} at position ${i + 1}`);
			if (i > 0 && v.at < item.versions[i - 1].at) problems.push(`${item.id}: v${v.version} time goes backward`);
			if (v.kind !== "withdrawn" && v.kind !== item.authored) {
				problems.push(`${item.id}: v${v.version} kind ${v.kind} differs from authored ${item.authored}`);
			}
			if (v.kind === "withdrawn" && v.pinned) problems.push(`${item.id}: withdrawal endcap v${v.version} is pinned`);
		});
		if (item.versions[0] && item.created !== item.versions[0].at) {
			problems.push(`${item.id}: created doesn't match v1 time`);
		}
	}
	return problems;
}

/**
 * Rules for moving from one ledger state to the next (or from what is already
 * deployed to what is about to be deployed). Anything returned here is a
 * protocol violation that readers would see (§13.3): items vanishing, version
 * numbers going backward, published versions rewritten, or pins revoked.
 */
export function checkTransition(prev: Ledger, next: Ledger): string[] {
	const problems: string[] = [];
	for (const [id, before] of Object.entries(prev.items)) {
		const after = next.items[id];
		if (!after) {
			problems.push(`${id}: item would disappear (published items can only be withdrawn)`);
			continue;
		}
		if (after.authored !== before.authored) problems.push(`${id}: kind changed`);
		if (after.versions.length < before.versions.length) {
			problems.push(`${id}: version would go backward (v${before.versions.length} → v${after.versions.length})`);
		}
		for (const old of before.versions) {
			const now = after.versions.find((v) => v.version === old.version);
			if (!now) continue;
			if (now.content_hash !== old.content_hash || now.content_html !== old.content_html || now.at !== old.at || now.kind !== old.kind) {
				problems.push(`${id}: published v${old.version} would be rewritten`);
			}
			if (old.pinned && !now.pinned) problems.push(`${id}: pin on v${old.version} would be revoked`);
		}
	}
	return problems;
}
