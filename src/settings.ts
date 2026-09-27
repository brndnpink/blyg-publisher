import { App, PluginSettingTab, Setting } from "obsidian";
import type { SiteConfig } from "./core/types";
import { validateSite } from "./core/surfaces";
import type BlygPublisherPlugin from "./main";
import { DEFAULT_FOLDER, folderProblem } from "./safety/root";

export interface BlygSettings {
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
	/** Cloudflare Pages project name. */
	pagesProject: string;
	/** Home page at the domain root (when the blyg is mounted below it). */
	homeIntro: string;
	/** One link per line: "Label | https://…" */
	homeLinks: string;
	/** Where the built site is written before upload. Empty = a temporary folder. */
	outputDir: string;
}

// Deliberately empty: nothing personal lives in the code.
export const DEFAULT_SETTINGS: BlygSettings = {
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

export function parseLinks(text: string): { label: string; url: string }[] {
	return text
		.split(/\r?\n/)
		.map((l) => l.split("|").map((x) => x.trim()))
		.filter(([label, url]) => label && url && /^(https?:|mailto:)/i.test(url))
		.map(([label, url]) => ({ label, url }));
}

export function siteConfig(s: BlygSettings, version: string): SiteConfig {
	const origin = s.origin.trim() && !s.origin.trim().endsWith("/") ? `${s.origin.trim()}/` : s.origin.trim();
	return {
		origin,
		title: s.title.trim(),
		...(s.description.trim() ? { description: s.description.trim() } : {}),
		author: { name: s.authorName.trim(), ...(s.authorBio.trim() ? { bio: s.authorBio.trim() } : {}), links: [] },
		generator: `blyg-publisher/${version}`,
	};
}

/** Settings problems that block publishing, in plain language. */
export function settingsProblems(s: BlygSettings, version: string): string[] {
	const out: string[] = [];
	if (!s.origin.trim()) out.push("Set your blyg's web address in Blyg Publisher settings.");
	else out.push(...validateSite(siteConfig(s, version)).filter((p) => !/title|author/.test(p)).map((p) => `Web address: ${p}.`));
	if (!s.title.trim()) out.push("Set a site title in Blyg Publisher settings.");
	if (!s.authorName.trim()) out.push("Set an author name in Blyg Publisher settings.");
	const folder = folderProblem(s.publishFolder);
	if (folder) out.push(`${folder} Fix it in Blyg Publisher settings.`);
	return out;
}

type StringKey = { [K in keyof BlygSettings]: BlygSettings[K] extends string ? K : never }[keyof BlygSettings];

export class BlygSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: BlygPublisherPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const text = (name: string, desc: string, key: StringKey, placeholder = "") =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((t) =>
					t
						.setPlaceholder(placeholder)
						.setValue(this.plugin.settings[key])
						.onChange(async (v) => {
							this.plugin.settings[key] = v;
							await this.plugin.saveSettings();
						}),
				);

		new Setting(containerEl).setName("Site").setHeading();
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
					.setValue(this.plugin.settings.homeLinks)
					.onChange(async (v) => {
						this.plugin.settings.homeLinks = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Deploy").setHeading();
		text("Cloudflare Pages project", "The project name in your Cloudflare account, e.g. my-site.", "pagesProject", "my-site");
		text("Output folder", "Optional. Where the site is built before upload. Leave empty for a temporary folder.", "outputDir");

		new Setting(containerEl).setName("Safety").setHeading();
		text(
			"Publish folder",
			"The ONE top-level folder that can be published; nothing outside it ever is. Your ledger lives in its .blyg subfolder, so set this once and leave it.",
			"publishFolder",
			DEFAULT_FOLDER,
		);
		new Setting(containerEl)
			.setName("Name scan")
			.setDesc("Before publishing and deploying, flag email addresses, phone numbers, \"IEP\", \"504\", and any names on your private list. You confirm or fix each match.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.nameScan).onChange(async (v) => {
					this.plugin.settings.nameScan = v;
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
