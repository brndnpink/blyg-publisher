import { App, PluginSettingTab, Setting } from "obsidian";
import type { SiteConfig } from "./core/types";
import { validateSite } from "./core/surfaces";
import type BlygPublisherPlugin from "./main";

export interface BlygSettings {
	/** Absolute URL of the blyg, ending in "/". */
	origin: string;
	title: string;
	description: string;
	authorName: string;
	authorBio: string;
	/** Absolute path (or ~/…) to the private name list, outside the vault. */
	denylistPath: string;
}

// Deliberately empty: nothing personal lives in the code.
export const DEFAULT_SETTINGS: BlygSettings = {
	origin: "",
	title: "",
	description: "",
	authorName: "",
	authorBio: "",
	denylistPath: "",
};

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
	if (!s.denylistPath.trim()) out.push("Set the location of your private name list in Blyg Publisher settings.");
	return out;
}

export class BlygSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: BlygPublisherPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const text = (name: string, desc: string, key: keyof BlygSettings, placeholder = "") =>
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

		new Setting(containerEl).setName("Safety").setHeading();
		text(
			"Private name list",
			"A text file OUTSIDE this vault's 7 - Blyg folder, one name per line. Publishing is blocked if it can't be read.",
			"denylistPath",
			"~/path/to/denylist.txt",
		);
		new Setting(containerEl)
			.setName("Publish folder")
			.setDesc("Fixed: only notes in \"7 - Blyg\" can ever be published. This can't be changed here.");
	}
}
