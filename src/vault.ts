// Bridges the pure safety and core modules to the live vault: which notes
// carry which blyg ids, link resolution, and the private name list.

import { readFileSync } from "fs";
import { homedir } from "os";
import type { App, TFile } from "obsidian";
import { latestVersion } from "./core/ledger";
import { pagePath } from "./core/surfaces";
import type { Ledger } from "./core/types";
import { isValidId } from "./core/util";
import type { VaultView } from "./safety/links";
import type { PublishRoot } from "./safety/root";
import { parseDenylist, type Denylist } from "./safety/scan";

export interface BlygIndex {
	/** blyg_id → every note claiming it (more than one means a duplicated file). */
	byId: Map<string, TFile[]>;
	byPath: Map<string, string>;
}

/** Scan notes in the publish folder for blyg_id properties. */
export function buildIndex(app: App, root: PublishRoot): BlygIndex {
	const byId = new Map<string, TFile[]>();
	const byPath = new Map<string, string>();
	for (const file of app.vault.getMarkdownFiles()) {
		if (!root.isPublishableNote(file.path)) continue;
		const id = app.metadataCache.getFileCache(file)?.frontmatter?.blyg_id;
		if (typeof id !== "string" || !isValidId(id)) continue;
		byPath.set(file.path, id);
		byId.set(id, [...(byId.get(id) ?? []), file]);
	}
	return { byId, byPath };
}

export function makeVaultView(app: App, index: BlygIndex, ledger: Ledger, origin: string, root: PublishRoot): VaultView {
	return {
		root,
		resolve(linkpath, sourcePath) {
			return app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)?.path ?? null;
		},
		published(path) {
			const id = index.byPath.get(path);
			const item = id ? ledger.items[id] : undefined;
			if (!item || latestVersion(item).kind === "withdrawn") return null;
			if ((index.byId.get(item.id)?.length ?? 0) > 1) return null;
			return { id: item.id, kind: item.authored, url: origin + pagePath(item) };
		},
		sameNameInRoot(linkpath) {
			const name = linkpath.split("/").pop()!.replace(/\.md$/, "").toLowerCase();
			return app.vault
				.getMarkdownFiles()
				.filter((f) => root.isPublishableNote(f.path) && f.basename.toLowerCase() === name)
				.map((f) => f.path);
		},
	};
}

export function expandHome(path: string): string {
	return path.startsWith("~/") ? homedir() + path.slice(1) : path;
}

/** Read the private name list. Throws with a plain-language message if it can't. */
export function readDenylist(path: string, root: PublishRoot): Denylist {
	const full = expandHome(path.trim());
	if (full.split("/").includes(root.folder) && full.includes(`/${root.folder}/`)) {
		throw new Error(`The private name list must not live inside the ${root.folder} folder.`);
	}
	try {
		return parseDenylist(readFileSync(full, "utf8"));
	} catch {
		throw new Error(`Can't read the private name list at ${path}. Publishing is blocked until it can be read.`);
	}
}
