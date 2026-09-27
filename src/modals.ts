// Confirmation windows. Nothing irreversible or public happens without one.

import { App, ButtonComponent, Modal, Notice, sanitizeHTMLToDom, Setting } from "obsidian";
import { latestVersion } from "./core/ledger";
import { renderMarkdown } from "./core/markdown";
import { resolveThread } from "./core/transclusion";
import { diffText } from "./diff";
import type BlygPublisherPlugin from "./main";
import { idsToNames, type NoteStatus } from "./status";

type Marked = Extract<NoteStatus, { state: "marked" }>;

export class PublishModal extends Modal {
	private note = "";
	private confirmed: boolean[];

	constructor(
		app: App,
		private plugin: BlygPublisherPlugin,
		private status: Marked,
	) {
		super(app);
		this.confirmed = status.check.flags.map(() => false);
	}

	onOpen() {
		const { contentEl, status } = this;
		const { check, file, latest, nextVersion } = status;
		const kind = check.kind!;
		const ctx = this.plugin.context!;
		this.modalEl.addClass("blyg-modal");
		this.setTitle(`Publish v${nextVersion} of "${file.basename}"`);
		contentEl.createDiv({
			cls: "blyg-sub",
			text: `${kind === "thread" ? "Thread" : "Fragment"} · goes live at ${ctx.origin || "your blyg"} the next time you deploy`,
		});

		// What the public will see, rendered exactly as the site will.
		let html = renderMarkdown(check.publicMarkdown);
		const extraProblems: string[] = [];
		if (kind === "thread") {
			const resolved = resolveThread(check.publicMarkdown, ctx.ledger);
			html = resolved.html;
			extraProblems.push(...resolved.errors);
		}

		const cols = contentEl.createDiv({ cls: "blyg-cols" });
		const pub = cols.createDiv({ cls: "blyg-pane" });
		pub.createEl("h4", { text: "Exactly what the public will see" });
		pub.createDiv({ cls: "blyg-public" }).append(sanitizeHTMLToDom(html));

		const changes = cols.createDiv({ cls: "blyg-pane" });
		const live = latest && latest.kind !== "withdrawn" ? latest : null;
		changes.createEl("h4", { text: live ? `Changes since v${live.version}` : "New" });
		const diffEl = changes.createDiv({ cls: "blyg-diff" });
		if (live) {
			const parts = diffText(idsToNames(live.content_md, ctx.index), idsToNames(check.publicMarkdown, ctx.index));
			if (!parts.some((p) => p.type !== "same")) {
				diffEl.createSpan({ text: "No text changes. Embedded fragments will update to their latest versions." });
			}
			for (const p of parts) diffEl.createEl(p.type === "add" ? "ins" : p.type === "del" ? "del" : "span", { text: p.text });
		} else {
			diffEl.createSpan({ text: idsToNames(check.publicMarkdown, ctx.index) });
		}

		const list = contentEl.createEl("ul", { cls: "blyg-checks" });
		if (kind === "fragment") {
			const n = check.publicMarkdown.length;
			list.createEl("li", { cls: n > 1000 ? "warn" : "ok", text: `${n.toLocaleString()} characters${n > 1000 ? " (over the recommended 1,000)" : ""}` });
		}
		for (const p of extraProblems) list.createEl("li", { cls: "bad", text: p });
		for (const w of check.warnings) list.createEl("li", { cls: "warn", text: w });
		if (!check.warnings.length && !extraProblems.length) list.createEl("li", { cls: "ok", text: "All safety checks passed" });

		// Every scan match must be confirmed individually (rule 6).
		let publishBtn: ButtonComponent | undefined;
		const update = () => publishBtn?.setDisabled(extraProblems.length > 0 || this.confirmed.some((c) => !c));
		if (check.flags.length) {
			const box = contentEl.createDiv({ cls: "blyg-flags" });
			box.createEl("h4", { text: `Name scan: ${check.flags.length} match${check.flags.length === 1 ? "" : "es"} to review` });
			check.flags.forEach((f, i) => {
				new Setting(box)
					.setName(`"${f.term}" (${f.source}, line ${f.line})`)
					.setDesc(f.excerpt)
					.addToggle((t) =>
						t.setTooltip("I've checked this and it's fine to publish").onChange((v) => {
							this.confirmed[i] = v;
							update();
						}),
					);
			});
		}

		new Setting(contentEl).setName("Change note").setDesc("Optional. Shown in the changelog.").addText((t) =>
			t.setPlaceholder(live ? "e.g. added an example" : "").onChange((v) => (this.note = v.trim())),
		);

		const foot = contentEl.createDiv({ cls: "blyg-foot" });
		foot.createSpan({
			cls: "blyg-tiny",
			text: "You can edit or withdraw it later, but copies already fetched by feed readers stay out there.",
		});
		new ButtonComponent(foot).setButtonText("Cancel").onClick(() => this.close());
		publishBtn = new ButtonComponent(foot)
			.setButtonText(`Publish v${nextVersion}`)
			.setCta()
			.onClick(async () => {
				publishBtn!.setDisabled(true);
				const ok = await this.plugin.publishNote(this.status, this.note);
				if (ok) this.close();
				else publishBtn!.setDisabled(false);
			});
		update();
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class PinModal extends Modal {
	constructor(
		app: App,
		private plugin: BlygPublisherPlugin,
		private status: Marked,
	) {
		super(app);
	}

	onOpen() {
		const item = this.status.item!;
		const candidates = [...item.versions].reverse().filter((v) => v.kind !== "withdrawn" && !v.pinned);
		this.modalEl.addClass("blyg-modal");
		this.setTitle(`Pin a version of "${this.status.file.basename}"`);
		if (!candidates.length) {
			this.contentEl.createEl("p", { text: "Every published version is already pinned." });
			return;
		}
		let version = candidates[0].version;
		let understood = false;
		this.contentEl.createEl("p", {
			text: "A pin is permanent. That exact version will stay public at its own address forever, even if you edit or withdraw this item later. There is no unpin.",
		});
		new Setting(this.contentEl).setName("Version").addDropdown((d) => {
			for (const v of candidates) d.addOption(String(v.version), `v${v.version} · ${v.at.slice(0, 10)}${v.note ? ` · ${v.note}` : ""}`);
			d.onChange((val) => (version = Number(val)));
		});
		let btn: ButtonComponent;
		new Setting(this.contentEl).setName("I understand this can't be undone").addToggle((t) =>
			t.onChange((v) => {
				understood = v;
				btn.setDisabled(!understood);
			}),
		);
		const foot = this.contentEl.createDiv({ cls: "blyg-foot" });
		new ButtonComponent(foot).setButtonText("Cancel").onClick(() => this.close());
		btn = new ButtonComponent(foot)
			.setButtonText("Pin permanently")
			.setWarning()
			.setDisabled(true)
			.onClick(async () => {
				if (await this.plugin.pinItem(item.id, version)) this.close();
			});
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class WithdrawModal extends Modal {
	constructor(
		app: App,
		private plugin: BlygPublisherPlugin,
		private status: Marked,
	) {
		super(app);
	}

	onOpen() {
		const item = this.status.item!;
		const latest = latestVersion(item);
		let note = "";
		let understood = false;
		this.modalEl.addClass("blyg-modal");
		this.setTitle(`Withdraw "${this.status.file.basename}"`);
		this.contentEl.createEl("p", {
			text: `This publishes v${latest.version + 1}, an empty "withdrawn" version. Blyg readers will drop the item. Its address keeps working but shows nothing. Pinned versions stay public, and threads that already quote it keep their copy. You can bring it back later by publishing again.`,
		});
		this.contentEl.createEl("p", { cls: "blyg-tiny", text: "There's no delete: copies already fetched by feed readers and archives can't be recalled." });
		new Setting(this.contentEl).setName("Note").setDesc("Optional, shown in the changelog.").addText((t) => t.onChange((v) => (note = v.trim())));
		let btn: ButtonComponent;
		new Setting(this.contentEl).setName("I understand").addToggle((t) =>
			t.onChange((v) => {
				understood = v;
				btn.setDisabled(!understood);
			}),
		);
		const foot = this.contentEl.createDiv({ cls: "blyg-foot" });
		new ButtonComponent(foot).setButtonText("Cancel").onClick(() => this.close());
		btn = new ButtonComponent(foot)
			.setButtonText("Withdraw")
			.setWarning()
			.setDisabled(true)
			.onClick(async () => {
				if (await this.plugin.withdrawItem(item.id, note || null)) this.close();
			});
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class PromoteModal extends Modal {
	constructor(
		app: App,
		private onChoose: (kind: "fragment" | "thread") => void,
		private name: string,
	) {
		super(app);
	}

	onOpen() {
		this.modalEl.addClass("blyg-modal");
		this.setTitle(`Copy "${this.name}" into 7 - Blyg`);
		this.contentEl.createEl("p", {
			text: "This makes a new copy for you to edit for the public. The original stays private and untouched. The copy's properties (tags, aliases) are left behind, and it isn't marked for publishing until you choose.",
		});
		const foot = this.contentEl.createDiv({ cls: "blyg-foot" });
		new ButtonComponent(foot).setButtonText("Cancel").onClick(() => this.close());
		new ButtonComponent(foot).setButtonText("Copy as thread").onClick(() => {
			this.close();
			this.onChoose("thread");
		});
		new ButtonComponent(foot)
			.setButtonText("Copy as fragment")
			.setCta()
			.onClick(() => {
				this.close();
				this.onChoose("fragment");
			});
	}

	onClose() {
		this.contentEl.empty();
	}
}

export function notice(msg: string, ms = 6000) {
	new Notice(`Blyg: ${msg}`, ms);
}
