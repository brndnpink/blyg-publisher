// Everything the panel, status bar, and publish window need to know about a
// note, computed in one place.

import { TFolder, type App, type TFile } from "obsidian";
import { latestVersion } from "./core/ledger";
import type { Ledger, LedgerItem, VersionRecord } from "./core/types";
import { checkNote, type CheckResult } from "./safety/check";
import type { PublishRoot } from "./safety/root";
import type { Denylist } from "./safety/scan";
import { normalizeOrigin, settingsProblems, type BlygSettings, type Target } from "./settings";
import type { LedgerStore } from "./store";
import { buildIndex, makeVaultView, readDenylist, type BlygIndex } from "./vault";

/** What the plugin last read from an existing blyg (server mode). */
export interface RemoteState {
	ledger: Ledger;
	/** Why the blyg couldn't be read, if it couldn't. */
	error: string | null;
	fetchedAt: number;
}

export interface Context {
	mode: Target;
	root: PublishRoot;
	ledger: Ledger;
	index: BlygIndex;
	denylist: Denylist | null;
	/** Null when the optional name scan is off. */
	/** Problems that block all publishing, not just one note. */
	global: string[];
	/** Published items no note points to (e.g. a note was deleted). */
	orphans: string[];
	origin: string;
}

export async function loadContext(
	app: App,
	store: LedgerStore,
	settings: BlygSettings,
	version: string,
	root: PublishRoot,
	remote: RemoteState | null,
): Promise<Context> {
	const global = settingsProblems(settings, version);
	if (!(app.vault.getAbstractFileByPath(root.folder) instanceof TFolder)) {
		global.push(`Create a folder named "${root.folder}" at the top of your vault. Only notes in it can be published.`);
	}
	let ledger: Ledger = { schema: 1, items: {} };
	const mode = settings.target;
	if (mode === "server") {
		if (remote) {
			ledger = remote.ledger;
			if (remote.error) global.push(remote.error);
		}
	} else {
		try {
			ledger = await store.load();
		} catch (e) {
			global.push((e as Error).message);
		}
	}
	const conflicts = mode === "static" ? await store.conflicts() : [];
	if (conflicts.length) {
		global.push(`Sync conflict in the ledger folder (${conflicts.map((c) => c.split("/").pop()).join(", ")}). Resolve it before publishing.`);
	}
	let denylist: Denylist | null = null;
	if (settings.nameScan) {
		denylist = { terms: [] };
		if (settings.denylistPath.trim()) {
			try {
				denylist = readDenylist(settings.denylistPath, root);
			} catch (e) {
				global.push((e as Error).message);
			}
		}
	}
	const index = buildIndex(app, root);
	const orphans = Object.keys(ledger.items).filter((id) => !index.byId.has(id));
	const origin = normalizeOrigin(settings.origin);
	// In server mode the blyg may hold items written elsewhere (its own studio); those aren't orphans.
	return { mode, root, ledger, index, denylist, global, orphans: mode === "static" ? orphans : [], origin };
}

export type NoteStatus =
	| { state: "none" }
	| { state: "private"; file: TFile }
	| { state: "unmarked"; file: TFile }
	| {
			state: "marked";
			file: TFile;
			check: CheckResult;
			/** check.problems plus note-level and global blockers, as plain messages. */
			blockers: string[];
			item: LedgerItem | null;
			latest: VersionRecord | null;
			/** The public text differs from the live version (or there is none yet). */
			edited: boolean;
			/** Thread only: embedded fragments that have newer versions than the ones baked in. */
			staleEmbeds: number;
			nextVersion: number;
	  };

export async function noteStatus(app: App, file: TFile | null, ctx: Context): Promise<NoteStatus> {
	if (!file || file.extension !== "md") return { state: "none" };
	if (!ctx.root.isPublishableNote(file.path)) return { state: "private", file };
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	if (fm?.blyg !== "publish") return { state: "unmarked", file };

	const text = await app.vault.cachedRead(file);
	const view = makeVaultView(app, ctx.index, ctx.ledger, ctx.origin, ctx.root);
	const check = checkNote({ path: file.path, basename: file.basename, text, frontmatter: fm }, view, ctx.denylist);

	const blockers = [...ctx.global, ...check.problems.map((p) => (p.line ? `Line ${p.line}: ${p.message}` : p.message))];
	const item = check.id ? (ctx.ledger.items[check.id] ?? null) : null;
	if (check.id && !item && ctx.mode === "static") {
		blockers.push("This note has a blyg_id the ledger doesn't know. The ledger may be out of date or restored from an old backup.");
	}
	if (check.id && (ctx.index.byId.get(check.id)?.length ?? 0) > 1) {
		const others = ctx.index.byId.get(check.id)!.filter((f) => f.path !== file.path).map((f) => f.path);
		blockers.push(`Another note has the same blyg_id (${others.join(", ")}). Was a file duplicated? Remove blyg_id from the copy.`);
	}
	if (item && check.kind && item.authored !== check.kind) {
		blockers.push(`This was published as a ${item.authored}; an item can't change kind. Set blyg_kind back to ${item.authored}.`);
	}

	const latest = item ? latestVersion(item) : null;
	const edited =
		!latest ||
		latest.kind === "withdrawn" ||
		check.publicMarkdown !== latest.content_md ||
		// Reference servers have no title field; only static mode publishes fragment titles.
		(ctx.mode === "static" && (latest.title ?? "") !== check.title);
	let staleEmbeds = 0;
	if (latest && latest.kind === "thread") {
		for (const t of latest.transclusions ?? []) {
			const src = ctx.ledger.items[t.id];
			if (src && latestVersion(src).kind !== "withdrawn" && latestVersion(src).version !== t.version) staleEmbeds++;
		}
	}
	return {
		state: "marked",
		file,
		check,
		blockers,
		item,
		latest,
		edited,
		staleEmbeds,
		nextVersion: latest ? latest.version + 1 : 1,
	};
}

/** Show thread directives by note name instead of id, for people. */
export function idsToNames(markdown: string, index: BlygIndex): string {
	return markdown.replace(/^(\s*)!\[\[([0-9a-z]{26})\]\]\s*$/gm, (whole, indent: string, id: string) => {
		const f = index.byId.get(id)?.[0];
		return f ? `${indent}![[${f.basename}]]` : whole;
	});
}
