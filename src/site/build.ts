// The whole deployable site as path → contents, relative to the domain root:
// protocol files and pages under the mount (e.g. blyg/), plus the home page,
// 404 page, and host configuration at the root. Pure and deterministic.

import { buildSurfaces } from "../core/surfaces";
import type { Ledger, SiteConfig } from "../core/types";
import { homePage, itemPage, listPage, notFoundPage, pathsFor, pinnedPage, type HomeConfig } from "./pages";
import { pagePath } from "../core/surfaces";
import { THEME_CSS } from "./theme";

export type SiteFiles = Map<string, string>;

/**
 * Cloudflare Pages headers. CORS on the blyg's files is what lets other blyg
 * clients read them (§4). The 404 page must exist: without it, Pages serves
 * index.html for unknown paths with status 200, and unknown item ids must 404.
 */
function headersFile(mount: string): string {
	return `${mount}*
  Access-Control-Allow-Origin: *
  X-Content-Type-Options: nosniff
${mount}feed.xml
  Content-Type: application/rss+xml; charset=utf-8
${mount}items/*
  Content-Type: application/json; charset=utf-8
${mount}blyg.json
  Content-Type: application/json; charset=utf-8
`;
}

export function buildSite(ledger: Ledger, site: SiteConfig, home: HomeConfig, now: string): SiteFiles {
	const p = pathsFor(site);
	const prefix = p.mount.replace(/^\//, ""); // "blyg/" (or "" for a root mount)
	const files: SiteFiles = new Map();

	for (const [path, body] of buildSurfaces(ledger, site, now)) files.set(prefix + path, body);

	files.set(`${prefix}style.css`, THEME_CSS);
	files.set(`${prefix}index.html`, listPage(ledger, site, p));
	for (const item of Object.values(ledger.items)) {
		files.set(`${prefix}${pagePath(item)}index.html`, itemPage(item, ledger, site, p));
		for (const v of item.versions) {
			if (v.pinned) files.set(`${prefix}${pagePath(item)}v${v.version}/index.html`, pinnedPage(item, v, site, p));
		}
	}

	if (prefix) files.set("index.html", homePage(site, home, p));
	files.set("404.html", notFoundPage(site, p));
	files.set("_headers", headersFile(p.mount));
	return files;
}
