// Human-readable HTML pages (spec 0.2 §4: SHOULD serve; presentation, not
// protocol). Pure string templates, no JavaScript on any page.
//
// Rules honored here:
// - Only the live version and pinned versions are ever shown or linked (§8.4).
// - Pinned pages carry that version's publish-time content_html verbatim,
//   rel=canonical to the live page, and a link to their JSON twin (§8.4).
// - Transclusion provenance links are page chrome added around the baked
//   blockquote, never written into content_html (§10.2).

import { latestVersion } from "../core/ledger";
import { excerptFromHtml, plainTextFromHtml } from "../core/markdown";
import { pagePath } from "../core/surfaces";
import type { Ledger, LedgerItem, SiteConfig, VersionRecord } from "../core/types";
import { escapeHtml } from "../core/util";

export interface HomeConfig {
	/** One or two sentences under the site title on the home page. */
	intro: string;
	links: { label: string; url: string }[];
}

/** Where things live, as absolute paths from the domain root. */
export interface Paths {
	/** e.g. "/blyg/" */
	mount: string;
	css: string;
	feed: string;
}

export function pathsFor(site: SiteConfig): Paths {
	const mount = new URL(site.origin).pathname;
	return { mount, css: `${mount}style.css`, feed: `${mount}feed.xml` };
}

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" });
export function formatDate(iso: string): string {
	return DATE.format(new Date(iso));
}

/** A thread's title is its first line if that's a heading; otherwise an excerpt. */
export function itemTitle(item: LedgerItem, v: VersionRecord = latestVersion(item)): string {
	if (v.title) return v.title;
	const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(v.content_md.split("\n").find((l) => l.trim() !== "") ?? "");
	if (item.authored === "thread" && heading) return plainTextFromHtml(heading[1]).replace(/[*_`]/g, "");
	return excerptFromHtml(v.content_html, 70) || (item.authored === "thread" ? "Untitled thread" : "Fragment");
}

function layout(site: SiteConfig, p: Paths, o: { title: string; body: string; head?: string; nav?: boolean }): string {
	const siteTitle = escapeHtml(site.title);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<link rel="stylesheet" href="${p.css}">
<link rel="alternate" type="application/rss+xml" title="${siteTitle}" href="${p.feed}">
<link rel="blyg" href="${p.mount}">
${o.head ?? ""}</head>
<body>
<header>
<a class="title" href="${p.mount}"><h1>${siteTitle}</h1></a>
${o.nav === false ? "" : `<nav><a href="/">home</a><a href="${p.mount}">blyg</a><a href="${p.feed}">feed</a></nav>`}
</header>
<main>
${o.body}
</main>
<footer>${siteTitle} · <a href="${p.feed}">RSS</a> · <a href="${p.mount}blyg.json">blyg.json</a></footer>
</body>
</html>
`;
}

function pinLinks(item: LedgerItem, p: Paths): string {
	const pins = item.versions.filter((v) => v.pinned);
	if (!pins.length) return "";
	const links = pins.map((v) => `<a href="${p.mount}${pagePath(item)}v${v.version}/">v${v.version}</a>`).join(", ");
	return ` · <span class="pin">◆ pinned: ${links}</span>`;
}

function changelog(item: LedgerItem, p: Paths): string {
	const rows = [...item.versions]
		.reverse()
		.map((v) => {
			const pin = v.pinned ? ` <span class="pin">◆ <a href="${p.mount}${pagePath(item)}v${v.version}/">pinned</a></span>` : "";
			const what = v.kind === "withdrawn" ? `withdrawn${v.note ? `: ${escapeHtml(v.note)}` : ""}` : escapeHtml(v.note ?? "");
			return `<li><span class="v">v${v.version}</span><span class="when">${formatDate(v.at)}</span><span>${what}${pin}</span></li>`;
		})
		.join("\n");
	return `<hr>\n<section class="changelog"><h2>Changelog</h2><ol>\n${rows}\n</ol></section>`;
}

/**
 * Add a provenance line inside each baked transclusion blockquote, linking to
 * the source fragment's page. Matches the exact baked wrapper, so fragments
 * that contain their own blockquotes can't confuse it.
 */
function withProvenance(v: VersionRecord, ledger: Ledger, p: Paths): string {
	let html = v.content_html;
	for (const t of v.transclusions ?? []) {
		const source = ledger.items[t.id];
		const baked = source?.versions.find((x) => x.version === t.version);
		if (!source || !baked) continue;
		const open = `<blockquote class="blyg-transclusion" data-blyg-id="${t.id}" data-blyg-version="${t.version}">\n`;
		const whole = `${open}${baked.content_html}\n</blockquote>`;
		const line = `<span class="tc-source">↳ <a href="${p.mount}${pagePath(source)}">fragment</a> · v${t.version} · ${formatDate(baked.at)}</span>\n`;
		html = html.split(whole).join(`${open}${baked.content_html}\n${line}</blockquote>`);
	}
	return html;
}

export function itemPage(item: LedgerItem, ledger: Ledger, site: SiteConfig, p: Paths): string {
	const latest = latestVersion(item);
	const kindLabel = item.authored === "thread" ? "Thread" : "Fragment";
	const jsonLink = `<link rel="alternate" type="application/json" href="${p.mount}items/${item.id}.json">`;

	if (latest.kind === "withdrawn") {
		const body = `<article class="${item.authored}">
<p class="byline">${kindLabel} · v${latest.version} · first published ${formatDate(item.created)}${pinLinks(item, p)}</p>
<p class="withdrawn">The author withdrew this ${item.authored} on ${formatDate(latest.at)}.${latest.note ? ` Note: “${escapeHtml(latest.note)}”` : ""}</p>
</article>
${changelog(item, p)}`;
		return layout(site, p, { title: `Withdrawn · ${site.title}`, body, head: `${jsonLink}\n<meta name="robots" content="noindex">\n` });
	}

	const title = itemTitle(item);
	const updated = item.versions.length > 1 ? ` · updated ${formatDate(latest.at)}` : "";
	const byline = `<p class="byline">${kindLabel} · v${latest.version} · first published ${formatDate(item.created)}${updated}${pinLinks(item, p)}</p>`;
	const content = item.authored === "thread" ? withProvenance(latest, ledger, p) : latest.content_html;
	const genKey = latest.generated?.length
		? `<p class="gen-key"><span class="blyg-tk-gen">Highlighted text</span> was drafted by an AI model from the author's own published fragments, then edited. Sources are listed in this item's <a href="${p.mount}items/${item.id}.json">data file</a>.</p>`
		: "";
	const body =
		item.authored === "thread"
			? `<article class="thread">\n${byline}\n<div class="content">\n${content}</div>\n${genKey}\n</article>\n${changelog(item, p)}`
			: `<article class="fragment">\n${latest.title ? `<h1>${escapeHtml(latest.title)}</h1>\n` : ""}<div class="content">\n${content}</div>\n${byline}\n${genKey}\n</article>\n${changelog(item, p)}`;
	return layout(site, p, { title: `${title} · ${site.title}`, body, head: `${jsonLink}\n` });
}

/** §8.4 pinned page: that version's content_html verbatim, visibly frozen. */
export function pinnedPage(item: LedgerItem, v: VersionRecord, site: SiteConfig, p: Paths): string {
	const live = `${site.origin}${pagePath(item)}`;
	const body = `<p class="frozen">◆ Frozen copy: <strong>version ${v.version}</strong>, pinned. This text stays at this address unchanged.
<a href="${p.mount}${pagePath(item)}">See the current version</a> · <a href="${p.mount}items/${item.id}/v${v.version}.json">JSON</a></p>
<article class="${item.authored}">
${item.authored === "fragment" && v.title ? `<h1>${escapeHtml(v.title)}</h1>\n` : ""}<p class="byline">${item.authored === "thread" ? "Thread" : "Fragment"} · v${v.version} · ${formatDate(v.at)}${v.note ? ` · “${escapeHtml(v.note)}”` : ""}</p>
<div class="content">
${v.content_html}</div>
</article>`;
	return layout(site, p, {
		title: `v${v.version} (pinned) · ${itemTitle(item, v)} · ${site.title}`,
		body,
		head: `<link rel="canonical" href="${live}">\n<link rel="alternate" type="application/json" href="${p.mount}items/${item.id}/v${v.version}.json">\n`,
	});
}

/** The /blyg/ page: live items, newest activity first, Bear-style. Withdrawn items are left out. */
export function listPage(ledger: Ledger, site: SiteConfig, p: Paths): string {
	const items = Object.values(ledger.items)
		.filter((i) => latestVersion(i).kind !== "withdrawn")
		.sort((a, b) => latestVersion(b).at.localeCompare(latestVersion(a).at) || a.id.localeCompare(b.id));
	const rows = items.map((item) => {
		const v = latestVersion(item);
		const href = `${p.mount}${pagePath(item)}`;
		const meta = v.version > 1 ? `<span class="meta">v${v.version} · updated</span>` : "";
		const pinned = item.versions.some((x) => x.pinned) ? ` <span class="pin">◆</span>` : "";
		const main =
			item.authored === "thread" || v.title
				? `<span class="kind">${item.authored}</span><a href="${href}">${escapeHtml(itemTitle(item))}</a>`
				: `<span class="kind">fragment</span>${escapeHtml(excerptFromHtml(v.content_html, 280))} <a href="${href}" class="meta" aria-label="permalink">#</a>`;
		return `<li><span class="date">${formatDate(v.at)}</span><span class="body">${main}${meta}${pinned}</span></li>`;
	});
	const tagline = site.description ? `<p class="tagline">${escapeHtml(site.description)}</p>\n` : "";
	const body = `${tagline}${rows.length ? `<ul class="entries">\n${rows.join("\n")}\n</ul>` : `<p class="empty">Nothing published yet.</p>`}`;
	return layout(site, p, { title: site.title, body });
}

/** Domain-root home page, when the blyg is mounted below the root. */
export function homePage(site: SiteConfig, home: HomeConfig, p: Paths): string {
	const links = [{ label: "blyg", url: p.mount }, ...home.links]
		.map((l) => `<li><a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a></li>`)
		.join("\n");
	const body = `${home.intro.trim() ? `<p>${escapeHtml(home.intro.trim())}</p>\n` : ""}<ul>\n${links}\n</ul>`;
	return layout(site, p, { title: site.title, body });
}

export function notFoundPage(site: SiteConfig, p: Paths): string {
	return layout(site, p, {
		title: `Not found · ${site.title}`,
		body: `<p>There's nothing at this address. <a href="${p.mount}">See everything that's published.</a></p>`,
		head: `<meta name="robots" content="noindex">\n`,
	});
}
