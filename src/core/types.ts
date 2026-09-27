// Shared types for the protocol core.

/** Protocol version this publisher implements (§3.1). Informative, not negotiated. */
export const PROTOCOL_VERSION = "0.2";
export const PROTOCOL_LEVEL = 1;
export const NAMESPACE_URI = "https://blygger.org/ns/0.1"; // permanent spelling, not a version (§7)
export const FEED_WINDOW = 50;
/** §5.3: publishers SHOULD cap fragments at 2,000 characters. Enforced here as a hard limit. */
export const FRAGMENT_MAX_CHARS = 2000;
export const TITLE_MAX_CHARS = 200;

export type AuthoredKind = "fragment" | "thread";
export type Kind = AuthoredKind | "withdrawn";

export interface Transclusion {
	id: string;
	version: number;
}

/** §5.7 generation provenance: one entry per generated span. Never carries instructions. */
export interface Generated {
	sources: Transclusion[];
	model?: string;
	at?: string;
}

export interface Media {
	url: string;
	mime: string;
	alt: string;
}

/**
 * One published version. The ledger keeps every version's full content
 * because pins may be made retroactively (§8 rule 2). The ledger itself is
 * private and never published; only pinned versions ever leave it.
 */
export interface VersionRecord {
	version: number;
	at: string;
	note: string | null;
	kind: Kind;
	content_md: string;
	content_html: string;
	content_hash: string;
	media: Media[];
	/** Threads (and withdrawn threads, as []) only. */
	transclusions?: Transclusion[];
	generated?: Generated[];
	/**
	 * Display title (the note's name, or blyg_title). Not a protocol field:
	 * emitted as an extra "title" member, which readers ignore (§13.1).
	 * Threads also carry it as a heading in content_md; fragments don't,
	 * so embeds stay clean.
	 */
	title?: string;
	pinned?: true;
}

export interface LedgerItem {
	id: string;
	/** Fixed at creation; an item never changes between fragment and thread. */
	authored: AuthoredKind;
	created: string;
	versions: VersionRecord[];
}

export interface Ledger {
	schema: 1;
	items: Record<string, LedgerItem>;
}

export interface SiteConfig {
	/** Absolute URL of the blyg, ending in "/", e.g. "https://example.com/blyg/". */
	origin: string;
	title: string;
	description?: string;
	author: {
		name: string;
		bio?: string;
		avatar?: string;
		links?: { label: string; url: string }[];
	};
	/** e.g. "blyg-publisher/0.1.0" */
	generator: string;
	/** Advertise blogroll.opml in the manifest (§6.1). Only when one is actually served. */
	blogroll?: boolean;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; errors: string[] };
