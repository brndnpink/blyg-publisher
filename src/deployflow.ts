// Orchestrates a deploy: check the live site, build, scan, write, upload,
// record. The network and process calls themselves live in src/deploy/.

import { tmpdir } from "os";
import { join } from "path";
import { checkLedger, latestVersion } from "./core/ledger";
import type { Ledger } from "./core/types";
import { toIso } from "./core/util";
import { compareWithLive, fetchLive, type Comparison } from "./deploy/live";
import { obsidianGet } from "./deploy/net";
import { writeSite } from "./deploy/output";
import { upload } from "./deploy/upload";
import { readDeploys, recordDeploy } from "./deploys";
import type BlygPublisherPlugin from "./main";
import { scan } from "./safety/scan";
import { parseLinks, siteConfig } from "./settings";
import { itemTitle } from "./site/pages";
import { buildSite } from "./site/build";
import { serialize } from "./store";
import { expandHome } from "./vault";

export interface SiteFlag {
	term: string;
	where: string;
	excerpt: string;
}

export interface DeployCheck {
	problems: string[];
	live: "none" | "unreachable" | "live";
	error?: string;
	liveItems: number;
	comparison: Comparison;
	flags: SiteFlag[];
	fileCount: number;
	previousDeploys: number;
}

/** Scan everything that will be public: live versions and every pinned version. */
export function scanSite(ledger: Ledger, denylist: { terms: string[] }): SiteFlag[] {
	const flags: SiteFlag[] = [];
	for (const item of Object.values(ledger.items)) {
		const latest = latestVersion(item);
		for (const v of item.versions) {
			const isPublic = (v === latest && v.kind !== "withdrawn") || v.pinned;
			if (!isPublic) continue;
			for (const f of scan(v.content_md, denylist)) {
				flags.push({ term: f.term, where: `"${itemTitle(item, v)}" v${v.version}`, excerpt: f.excerpt });
			}
		}
	}
	return flags;
}

export interface DeployResult {
	ok: boolean;
	url?: string | null;
	hint?: string;
}

export interface Planner {
	origin: string;
	check(): Promise<DeployCheck>;
	deploy(onOutput: (s: string) => void): Promise<DeployResult>;
}

export function makePlanner(plugin: BlygPublisherPlugin): Planner {
	const site = () => siteConfig(plugin.settings, plugin.manifest.version);
	const origin = site().origin;
	let checkedLedger = "";
	let files: Map<string, string> | null = null;

	return {
		origin,

		async check() {
			await plugin.refresh();
			const ctx = plugin.context!;
			const problems = [...ctx.global];
			if (!plugin.settings.pagesProject.trim()) problems.push("Set the Cloudflare Pages project name in Blyg Publisher settings.");
			const ledger = ctx.ledger;
			problems.push(...checkLedger(ledger));

			const live = await fetchLive(origin, obsidianGet);
			const comparison = compareWithLive(ledger, live);
			problems.push(...comparison.problems);

			try {
				files = buildSite(ledger, site(), { intro: plugin.settings.homeIntro, links: parseLinks(plugin.settings.homeLinks) }, toIso());
			} catch (e) {
				problems.push((e as Error).message);
				files = null;
			}
			checkedLedger = serialize(ledger);
			return {
				problems,
				live: live.kind,
				error: live.kind === "unreachable" ? live.error : undefined,
				liveItems: live.kind === "live" ? live.index.length : 0,
				comparison,
				flags: ctx.denylist ? scanSite(ledger, ctx.denylist) : [],
				fileCount: files?.size ?? 0,
				previousDeploys: (await readDeploys(plugin.app.vault.adapter)).length,
			};
		},

		async deploy(onOutput) {
			// Refuse if the ledger changed since the check (e.g. synced from another Mac).
			const fresh = await plugin.store.load();
			if (!files || serialize(fresh) !== checkedLedger) {
				return { ok: false, hint: "The ledger changed after the check. Close this window and deploy again." };
			}
			const dir = plugin.settings.outputDir.trim() ? expandHome(plugin.settings.outputDir.trim()) : join(tmpdir(), "blyg-publisher-site");
			try {
				const count = writeSite(files, dir);
				onOutput(`Built ${count} files in ${dir}\nUploading…\n`);
			} catch (e) {
				return { ok: false, hint: (e as Error).message };
			}
			const res = await upload(dir, plugin.settings.pagesProject.trim(), onOutput);
			if (!res.ok) {
				const o = res.output.toLowerCase();
				const hint = /not (logged|authenticated)|login|authentication|api token/.test(o)
					? "Wrangler isn't logged in. In Terminal, run: npx wrangler@4 login"
					: /project not found|could not find project|8000007/.test(o)
						? `There's no Pages project named "${plugin.settings.pagesProject}". Create it first (see the setup steps).`
						: /command not found|npx: not found|enoent/.test(o)
							? "Couldn't find Node's npx. Is Node installed?"
							: undefined;
				return { ok: false, hint };
			}
			await recordDeploy(plugin.app.vault.adapter, {
				at: toIso(),
				origin,
				url: res.url,
				items: Object.keys(fresh.items).length,
				files: files.size,
			});
			await plugin.refresh();
			return { ok: true, url: res.url };
		},
	};
}
