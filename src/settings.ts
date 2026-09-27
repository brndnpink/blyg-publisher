import { App, PluginSettingTab, Setting } from "obsidian";
import type { SiteConfig } from "./core/types";
import { validateSite } from "./core/surfaces";
import type BlygPublisherPlugin from "./main";
import { DEFAULT_FOLDER, folderProblem } from "./safety/root";

/**
 * Where publishing goes:
 * - "server": an existing blyg run by the Blygger reference server. Publish
 *   goes live immediately through its owner API; the server keeps history.
 * - "static": the plugin keeps the history (ledger) and deploys a static
 *   site to Cloudflare Pages.
 */
export type Target = "server" | "static";

export interface BlygSettings {
	target: Target;
	/** Absolute URL of the blyg, ending in "/". */
	origin: string;
	title: string;
	description: string;
	authorName: string;
	authorBio: string;
	/** The one top-level folder that can be published. Chosen once at setup. */
	publishFolder: string;
	/** Optional name scan: flag listed names and email/phone/IEP/504 before publishing. Off by default. */
	nameScan: boolean;
	/** Optional private list for the name scan (absolute or ~/ path), kept outside the publish folder. */
	denylistPath: string;
	/** Static mode: Cloudflare Pages project name. */
	pagesProject: string;
	/** Static mode: home page at the domain root (when the blyg is mounted below it). */
	homeIntro: string;
	/** Static mode: one link per line, "Label | https://…" */
	homeLinks: string;
	/** Static mode: where the built site is written before upload. Empty = a temporary folder. */
	outputDir: string;
}

// Deliberately empty: nothing personal lives in the code.
export const DEFAULT_SETTINGS: BlygSettings = {
	target: "server",
	origin: "",
	title: "",
	description: "",
	authorName: "",
	authorBio: "",
	publishFolder: DEFAULT_FOLDER,
	nameScan: false,
	denylistPath: "",
	pagesProject: "",
	homeIntro: "",
	homeLinks: "",
	outputDir: "",
};

export function normalizeOrigin(raw: string): string {
	const o = raw.trim();
	return o && !o.endsWith("/") ? `${o}/` : o;
}

export function parseLinks(text: string): { label: string; url: string }[] {
	return text
		.split(/\r?\n/)
		.map((l) => l.split("|").map((x) => x.trim()))
		.filter(([label, url]) => label && url && /^(https?:|mailto:)/i.test(url))
		.map(([label, url]) => ({ label, url }));
}

export function siteConfig(s: BlygSettings, version: string): SiteConfig {
	return {
		origin: normalizeOrigin(s.origin),
		title: s.title.trim(),
		...(s.description.trim() ? { description: s.description.trim() } : {}),
		author: { name: s.authorName.trim(), ...(s.authorBio.trim() ? { bio: s.authorBio.trim() } : {}), links: [] },
		generator: `blyg-publisher/${version}`,
	};
}

function serverOriginProblem(origin: string): string | null {
	try {
		const u = new URL(origin);
		const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
		if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return "the blyg address must start with https://";
		if (u.search || u.hash) return "the blyg address can't have a query or #fragment";
		return null;
	} catch {
		return "the blyg address isn't a valid URL";
	}
}

/** Settings problems that block publishing, in plain language. */
export function settingsProblems(s: BlygSettings, version: string): string[] {
	const out: string[] = [];
	if (!s.origin.trim()) {
		out.push(s.target === "server" ? "Set your blyg's address in Blyg Publisher settings." : "Set your blyg's web address in Blyg Publisher settings.");
	} else if (s.target === "server") {
		const p = serverOriginProblem(normalizeOrigin(s.origin));
		if (p) out.push(`Blyg address: ${p}.`);
	} else {
		out.push(...validateSite(siteConfig(s, version)).filter((p) => !/title|author/.test(p)).map((p) => `Web address: ${p}.`));
		if (!s.title.trim()) out.push("Set a site title in Blyg Publisher settings.");
		if (!s.authorName.trim()) out.push("Set an author name in Blyg Publisher settings.");
	}
	const folder = folderProblem(s.publishFolder);
	if (folder) out.push(`${folder} Fix it in Blyg Publisher settings.`);
	return out;
}

type StringKey = { [K in keyof BlygSettings]: string extends BlygSettings[K] ? K : never }[keyof BlygSettings];

export class BlygSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: BlygPublisherPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		const text = (name: string, desc: string, key: StringKey, placeholder = "") =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((t) =>
					t
						.setPlaceholder(placeholder)
						.setValue(s[key])
						.onChange(async (v) => {
							s[key] = v;
							await this.plugin.saveSettings();
						}),
				);

		new Setting(containerEl).setName("Where to publish").setHeading();
		new Setting(containerEl)
			.setName("Publish to")
			.setDesc(
				s.target === "server"
					? "An existing blyg running the Blygger reference server (like most blygs today). Publishing goes live on it immediately; its studio keeps the history."
					: "A static site this plugin builds and deploys to Cloudflare Pages. The plugin keeps the history in the publish folder.",
			)
			.addDropdown((d) =>
				d
					.addOption("server", "My existing blyg")
					.addOption("static", "A static site I deploy (Cloudflare Pages)")
					.setValue(s.target)
					.onChange(async (v) => {
						s.target = v as Target;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (s.target === "server") {
			text("Blyg address", "Your blyg's public address, e.g. https://example.com/blyg/ (the page that lists your fragments and threads).", "origin", "https://example.com/blyg/");
			const account = new Setting(containerEl).setName("Account");
			if (this.plugin.hasSession()) {
				account.setDesc("Logged in to your blyg's studio. The password isn't stored; only the login session is, in Obsidian's secure storage.");
				account.addButton((b) =>
					b.setButtonText("Log out").onClick(() => {
						this.plugin.clearSession();
						this.display();
					}),
				);
			} else {
				account.setDesc("Log in with your blyg's studio password. It's used once and not stored.");
				account.addButton((b) =>
					b
						.setButtonText("Log in…")
						.setCta()
						.onClick(() => this.plugin.openLogin(() => this.display())),
				);
			}
		} else {
			text("Web address", "Where the blyg lives, ending in a slash.", "origin", "https://example.com/blyg/");
			text("Title", "Shown at the top of the site and in feed readers.", "title");
			text("Description", "One line for feed readers. Optional.", "description");
			text("Author name", "The byline on every item. Use your pen name if you have one.", "authorName");
			text("Author bio", "Optional.", "authorBio");

			new Setting(containerEl).setName("Home page").setHeading();
			text("Intro", "A sentence or two for the home page at the domain root.", "homeIntro");
			new Setting(containerEl)
				.setName("Links")
				.setDesc('One per line, "Label | https://…". Shown on the home page under the blyg link.')
				.addTextArea((t) =>
					t
						.setPlaceholder("Newsletter | https://example.substack.com")
						.setValue(s.homeLinks)
						.onChange(async (v) => {
							s.homeLinks = v;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl).setName("Deploy").setHeading();
			text("Cloudflare Pages project", "The project name in your Cloudflare account, e.g. my-site.", "pagesProject", "my-site");
			text("Output folder", "Optional. Where the site is built before upload. Leave empty for a temporary folder.", "outputDir");
		}

		new Setting(containerEl).setName("Safety").setHeading();
		text(
			"Publish folder",
			"The ONE top-level folder that can be published; nothing outside it ever is. Set this once and leave it.",
			"publishFolder",
			DEFAULT_FOLDER,
		);
		new Setting(containerEl)
			.setName("Name scan")
			.setDesc('Before publishing, flag email addresses, phone numbers, "IEP", "504", and any names on your private list. You confirm or fix each match.')
			.addToggle((t) =>
				t.setValue(s.nameScan).onChange(async (v) => {
					s.nameScan = v;
					await this.plugin.saveSettings();
				}),
			);
		text(
			"Private name list",
			"Optional, used by the name scan: a text file outside the publish folder, one name per line. If set and unreadable, publishing is blocked.",
			"denylistPath",
			"~/path/to/names.txt",
		);
	}
}
