// IDs, hashing, timestamps, escaping — spec 0.2 §5.1, §4.
// Pure: no Obsidian imports, runs in Node (tests) and Electron (plugin).

/** Crockford base32, lowercase, no i/l/o/u (§5.1). */
export const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

const ID_PATTERN = new RegExp(`^[${ID_ALPHABET}]{26}$`);

export function isValidId(id: string): boolean {
	return ID_PATTERN.test(id);
}

/**
 * 128 random bits as 26 chars of lowercase Crockford base32, big-endian with
 * two leading zero bits (26 × 5 = 130). Same encoding as the reference client.
 */
export function newId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	let n = 0n;
	for (const b of bytes) n = (n << 8n) | BigInt(b);
	let out = "";
	for (let i = 0; i < 26; i++) {
		out = ID_ALPHABET[Number(n & 31n)] + out;
		n >>= 5n;
	}
	return out;
}

/** `"sha256:" + hex(SHA-256(content_md as UTF-8))` — covers content_md only (§5.1). */
export async function contentHash(contentMd: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(contentMd));
	return "sha256:" + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** ISO 8601 UTC, second precision, Z suffix (§4). */
export function toIso(date: Date = new Date()): string {
	return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** RFC 822 date for RSS `pubDate` / `lastBuildDate` (§7). */
export function rfc822(iso: string): string {
	return new Date(iso).toUTCString();
}

export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function escapeXml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Wrap text in CDATA, splitting any `]]>` so it can't close the section early. */
export function cdata(s: string): string {
	return "<![CDATA[" + s.replaceAll("]]>", "]]]]><![CDATA[>") + "]]>";
}

/**
 * Rewrite relative src/href URLs against the blyg origin. Feed descriptions
 * must be self-contained (§7): no dependence on the origin's paths.
 */
export function absolutizeHtml(html: string, origin: string): string {
	const host = new URL(origin).origin;
	return html.replace(/(src|href)="([^"]*)"/g, (m, attr: string, url: string) => {
		if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) || url.startsWith("//") || url.startsWith("#")) return m;
		if (url.startsWith("/")) return `${attr}="${host}${url}"`;
		return `${attr}="${origin}${url}"`;
	});
}
