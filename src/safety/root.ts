// The publish-folder lock (security rule 1). Pure; no Obsidian imports.
//
// Exactly one top-level folder can ever be published. It's chosen once at
// setup (default "Blyg"); nothing outside it is ever read for publishing.

export const DEFAULT_FOLDER = "Blyg";

function hasBadSegment(path: string): boolean {
	return path.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
}

/** Why a folder name can't be the publish folder, or null if it's fine. */
export function folderProblem(name: string): string | null {
	const n = name.trim();
	if (!n) return "The publish folder name is empty.";
	if (n.includes("/") || n.includes("\\")) return "The publish folder must be a single top-level folder (no slashes).";
	if (n.startsWith(".")) return "The publish folder can't be a hidden folder.";
	if (n !== name) return "The publish folder name has leading or trailing spaces.";
	return null;
}

export class PublishRoot {
	constructor(readonly folder: string = DEFAULT_FOLDER) {
		const problem = folderProblem(folder);
		if (problem) throw new Error(problem);
	}

	/** Plugin-managed state (ledger, backups, deploy log); never publishable. */
	get stateDir(): string {
		return `${this.folder}/.blyg`;
	}

	/** Only images from here can be published (rule 4). */
	get mediaDir(): string {
		return `${this.folder}/media`;
	}

	/** True only for a vault-relative path strictly inside the folder, with no traversal. */
	contains(path: string): boolean {
		return path.startsWith(`${this.folder}/`) && !hasBadSegment(path);
	}

	/** A note that could be published: Markdown, inside the folder, outside plugin state. */
	isPublishableNote(path: string): boolean {
		return this.contains(path) && path.endsWith(".md") && !path.startsWith(`${this.stateDir}/`);
	}

	inMedia(path: string): boolean {
		return path.startsWith(`${this.mediaDir}/`) && !hasBadSegment(path);
	}
}
