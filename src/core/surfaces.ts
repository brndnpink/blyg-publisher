// Builds the protocol surface (spec 0.2 §4) from a ledger: every file a
// static host needs to serve, as path → contents. Deterministic for a given
// ledger and config, so the same ledger always deploys the same bytes.
// Field order in the JSON documents follows the reference client's output.

import { excerptFromHtml } from "./markdown";
import { latestVersion } from "./ledger";
import type { Ledger, LedgerItem, SiteConfig, VersionRecord } from "./types";
import { FEED_WINDOW, NAMESPACE_URI, PROTOCOL_LEVEL, PROTOCOL_VERSION } from "./types";
import { absolutizeHtml, cdata, escapeXml, rfc822 } from "./util";

export type Surfaces = Map<string, string>;

function itemAuthor(site: SiteConfig) {
	return { name: site.author.name, url: site.origin };
}

/** Permalink path for an item's HTML page, origin-relative: f/{id}/ or t/{id}/. */
export function pagePath(item: LedgerItem): string {
	return `${item.authored === "thread" ? "t" : "f"}/${item.id}/`;
}

function itemUpdated(item: LedgerItem): string {
	return latestVersion(item).at;
}

/** Newest first by `updated`; ties broken by `created`, then id, so output is stable. */
function sortedItems(ledger: Ledger): LedgerItem[] {
	return Object.values(ledger.items).sort(
		(a, b) =>
			itemUpdated(b).localeCompare(itemUpdated(a)) ||
			b.created.localeCompare(a.created) ||
			a.id.localeCompare(b.id),
	);
}

function lastUpdated(ledger: Ledger, fallback: string): string {
	const items = sortedItems(ledger);
	return items.length ? itemUpdated(items[0]) : fallback;
}

/** §5 item document: latest content only, full changelog metadata. */
export function buildItemDocument(item: LedgerItem, site: SiteConfig) {
	const latest = latestVersion(item);
	const withdrawn = latest.kind === "withdrawn";
	return {
		blyg: PROTOCOL_VERSION,
		id: item.id,
		kind: latest.kind,
		origin: site.origin,
		page: pagePath(item),
		author: itemAuthor(site),
		created: item.created,
		updated: latest.at,
		version: latest.version,
		content_md: latest.content_md,
		content_html: latest.content_html,
		content_hash: latest.content_hash,
		media: withdrawn ? [] : latest.media,
		...(item.authored === "thread" ? { transclusions: withdrawn ? [] : (latest.transclusions ?? []) } : {}),
		...(!withdrawn && latest.generated?.length ? { generated: latest.generated } : {}),
		changelog: item.versions.map((v) => ({
			version: v.version,
			at: v.at,
			note: v.note,
			...(v.pinned ? { pinned: true } : {}),
		})),
	};
}

/** §8 pinned version document: that version's own publish-time content, forever. */
export function buildPinnedDocument(item: LedgerItem, v: VersionRecord, site: SiteConfig) {
	return {
		blyg: PROTOCOL_VERSION,
		id: item.id,
		kind: v.kind,
		version: v.version,
		at: v.at,
		note: v.note,
		pinned: true,
		origin: site.origin,
		author: itemAuthor(site),
		content_md: v.content_md,
		content_html: v.content_html,
		content_hash: v.content_hash,
		...(item.authored === "thread" ? { transclusions: v.transclusions ?? [] } : {}),
		...(v.generated?.length ? { generated: v.generated } : {}),
	};
}

/** §6.1 manifest. */
export function buildManifest(ledger: Ledger, site: SiteConfig, now: string) {
	const { name, bio, avatar, links } = site.author;
	return {
		blyg: PROTOCOL_VERSION,
		level: PROTOCOL_LEVEL,
		generator: site.generator,
		site: site.origin,
		title: site.title,
		author: {
			name,
			...(bio !== undefined ? { bio } : {}),
			...(avatar !== undefined ? { avatar } : {}),
			links: links ?? [],
		},
		feed: "feed.xml",
		items: "items/index.json",
		updated: lastUpdated(ledger, now),
		...(site.blogroll ? { blogroll: "blogroll.opml" } : {}),
	};
}

/** §6.2 archive index: every item ever published, withdrawn included, no window. */
export function buildArchiveIndex(ledger: Ledger, now: string) {
	return {
		updated: lastUpdated(ledger, now),
		items: sortedItems(ledger).map((item) => {
			const latest = latestVersion(item);
			return { id: item.id, kind: latest.kind, created: item.created, updated: latest.at, version: latest.version };
		}),
	};
}

interface FeedEvent {
	item: LedgerItem;
	version: VersionRecord;
}

/**
 * §7: one entry per publish event, newest first, bounded window. A withdrawn
 * item contributes only its withdrawal event. Pinning is not an event.
 */
function feedEvents(ledger: Ledger): FeedEvent[] {
	const events: FeedEvent[] = [];
	for (const item of Object.values(ledger.items)) {
		const latest = latestVersion(item);
		if (latest.kind === "withdrawn") events.push({ item, version: latest });
		else for (const version of item.versions) events.push({ item, version });
	}
	events.sort(
		(a, b) =>
			b.version.at.localeCompare(a.version.at) ||
			b.version.version - a.version.version ||
			a.item.id.localeCompare(b.item.id),
	);
	return events.slice(0, FEED_WINDOW);
}

/** §7 feed.xml. Every entry carries the item's *latest* content, never historical content. */
export function buildFeed(ledger: Ledger, site: SiteConfig, now: string): string {
	const o = site.origin;
	const entries = feedEvents(ledger).map(({ item, version }) => {
		const latest = latestVersion(item);
		const withdrawn = latest.kind === "withdrawn";
		let html = "";
		if (!withdrawn) {
			html = absolutizeHtml(latest.content_html, o);
			for (const m of latest.media) {
				const src = /^[a-z][a-z0-9+.-]*:/i.test(m.url) ? m.url : o + m.url;
				html += `<p><img src="${escapeXml(src)}" alt="${escapeXml(m.alt)}"></p>`;
			}
		}
		const excerpt = withdrawn ? "" : excerptFromHtml(latest.content_html, 60);
		const title = withdrawn ? "withdrawn" : version.note ? `${version.note} — ${excerpt}` : excerpt;
		return `    <item>
      <guid isPermaLink="false">blyg:${item.id}:v${version.version}</guid>
      <link>${o}${pagePath(item)}</link>
      <title>${escapeXml(title)}</title>
      <description>${withdrawn ? "" : cdata(html)}</description>
      <pubDate>${rfc822(version.at)}</pubDate>
      <dc:creator>${escapeXml(site.author.name)}</dc:creator>
      <blyg:id>${item.id}</blyg:id>
      <blyg:kind>${latest.kind}</blyg:kind>
      <blyg:version>${version.version}</blyg:version>
      <blyg:created>${item.created}</blyg:created>
      <blyg:item>${o}items/${item.id}.json</blyg:item>
    </item>`;
	});
	const description = site.description ?? site.author.bio ?? "";
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:blyg="${NAMESPACE_URI}" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(site.title)}</title>
    <link>${o}</link>
    <description>${escapeXml(description)}</description>
    <lastBuildDate>${rfc822(lastUpdated(ledger, now))}</lastBuildDate>
    <blyg:level>${PROTOCOL_LEVEL}</blyg:level>
    <blyg:manifest>${o}blyg.json</blyg:manifest>
${entries.join("\n")}
  </channel>
</rss>
`;
}

export function validateSite(site: SiteConfig): string[] {
	const problems: string[] = [];
	try {
		const u = new URL(site.origin);
		if (u.protocol !== "https:") problems.push("origin must use https");
		if (u.search || u.hash) problems.push("origin can't have a query or fragment");
	} catch {
		problems.push(`origin is not a URL: ${site.origin}`);
	}
	if (!site.origin.endsWith("/")) problems.push("origin must end with /");
	if (!site.title.trim()) problems.push("title is empty");
	if (!site.author.name.trim()) problems.push("author name is empty");
	return problems;
}

/** Every protocol file for the blyg, keyed by origin-relative path. */
export function buildSurfaces(ledger: Ledger, site: SiteConfig, now: string): Surfaces {
	const problems = validateSite(site);
	if (problems.length) throw new Error(`invalid site config: ${problems.join("; ")}`);

	const files: Surfaces = new Map();
	files.set("blyg.json", JSON.stringify(buildManifest(ledger, site, now)));
	files.set("items/index.json", JSON.stringify(buildArchiveIndex(ledger, now)));
	files.set("feed.xml", buildFeed(ledger, site, now));
	for (const item of sortedItems(ledger)) {
		files.set(`items/${item.id}.json`, JSON.stringify(buildItemDocument(item, site)));
		for (const v of item.versions) {
			if (v.pinned) files.set(`items/${item.id}/v${v.version}.json`, JSON.stringify(buildPinnedDocument(item, v, site)));
		}
	}
	return files;
}
