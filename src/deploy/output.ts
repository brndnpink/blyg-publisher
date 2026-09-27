// Writing the built site to a local folder for upload. The folder is cleared
// first, but only if this plugin created it: a marker file must be present,
// or the folder must be empty or absent. It never clears any other folder.

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";

export const MARKER = ".blyg-site-output";

export function prepareOutputDir(dir: string): void {
	const full = resolve(dir);
	if (full === "/" || full.split("/").filter(Boolean).length < 3) {
		throw new Error(`Refusing to use ${full} as the output folder; choose a dedicated folder.`);
	}
	if (existsSync(full)) {
		const entries = readdirSync(full);
		if (entries.length && !entries.includes(MARKER)) {
			throw new Error(`${full} already contains files this plugin didn't create. Choose an empty or dedicated folder.`);
		}
		for (const e of entries) rmSync(join(full, e), { recursive: true, force: true });
	}
	mkdirSync(full, { recursive: true });
	writeFileSync(join(full, MARKER), "Created by Blyg Publisher. This folder is rebuilt on every deploy.\n");
}

/** Write every file under dir. Paths must be relative with no traversal. */
export function writeSite(files: Map<string, string>, dir: string): number {
	prepareOutputDir(dir);
	const root = resolve(dir);
	for (const [path, body] of files) {
		const target = resolve(root, path);
		if (!target.startsWith(root + "/") || path.split("/").includes("..")) {
			throw new Error(`Refusing to write outside the output folder: ${path}`);
		}
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, body);
	}
	return files.size;
}
