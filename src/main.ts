import { Notice, Plugin, TFile, TFolder } from "obsidian";
import { isPublishableNotePath, PUBLISH_ROOT } from "./safety/root";

export default class BlygPublisherPlugin extends Plugin {
	async onload() {
		this.addCommand({
			id: "publish",
			name: "Publish",
			callback: () => this.publish(),
		});
	}

	private publish() {
		const root = this.app.vault.getAbstractFileByPath(PUBLISH_ROOT);
		if (!(root instanceof TFolder)) {
			new Notice(`Blyg: folder "${PUBLISH_ROOT}" not found. Nothing to publish.`);
			return;
		}

		const notes = this.app.vault
			.getMarkdownFiles()
			.filter((f: TFile) => isPublishableNotePath(f.path));
		const optedIn = notes.filter(
			(f) => this.app.metadataCache.getFileCache(f)?.frontmatter?.blyg === "publish",
		);

		new Notice(
			`Blyg: ${notes.length} note(s) in "${PUBLISH_ROOT}", ` +
				`${optedIn.length} marked "blyg: publish". ` +
				`Publishing isn't built yet.`,
		);
	}
}
