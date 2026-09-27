// The publish-root lock (security rule 1). Pure; no Obsidian imports.

/**
 * The only folder this plugin may ever publish from. Deliberately a constant,
 * not a setting: widening it should take a code change, not a click.
 */
export const PUBLISH_ROOT = "7 - Blyg";

/** Only images from here can be published (rule 4). */
export const MEDIA_DIR = `${PUBLISH_ROOT}/media`;

/** Plugin-managed state; never publishable. */
export const STATE_DIR = `${PUBLISH_ROOT}/.blyg`;

function hasBadSegment(path: string): boolean {
	return path.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
}

/** True only for a vault-relative path strictly inside PUBLISH_ROOT, with no traversal. */
export function isInPublishRoot(path: string): boolean {
	return path.startsWith(`${PUBLISH_ROOT}/`) && !hasBadSegment(path);
}

/** A note that could be published: Markdown, inside the root, outside plugin state. */
export function isPublishableNotePath(path: string): boolean {
	return isInPublishRoot(path) && path.endsWith(".md") && !path.startsWith(`${STATE_DIR}/`);
}

export function isInMediaDir(path: string): boolean {
	return path.startsWith(`${MEDIA_DIR}/`) && !hasBadSegment(path);
}
