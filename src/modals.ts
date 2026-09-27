// Confirmation windows. Nothing irreversible or public happens without one.

import { App, ButtonComponent, Modal, Notice, sanitizeHTMLToDom, Setting } from "obsidian";
import { latestVersion } from "./core/ledger";
import { pagePath } from "./core/surfaces";
import type { LedgerItem } from "./core/types";
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
		const pubBody = pub.createDiv({ cls: "blyg-public" });
		if (kind === "fragment") pubBody.createEl("h2", { cls: "blyg-public-title", text: check.title });
		pubBody.append(sanitizeHTMLToDom(html));

		const changes = cols.createDiv({ cls: "blyg-pane" });
		const live = latest && latest.kind !== "withdrawn" ? latest : null;
		changes.createEl("h4", { text: live ? `Changes since v${live.version}` : "New" });
		const diffEl = changes.createDiv({ cls: "blyg-diff" });
		if (live) {
			const parts = diffText(idsToNames(live.content_md, ctx.index), idsToNames(check.publicMarkdown, ctx.index));
			if (kind === "fragment" && (live.title ?? "") !== check.title) {
				const t = diffEl.createDiv({ cls: "blyg-tiny" });
				t.createSpan({ text: "Title: " });
				if (live.title) t.createEl("del", { text: live.title });
				t.createEl("ins", { text: check.title });
			}
			if (!parts.some((p) => p.type !== "same") && (live.title ?? "") === check.title) {
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
		private initial?: number,
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
		let version = candidates.find((v) => v.version === this.initial)?.version ?? candidates[0].version;
		let understood = false;
		this.contentEl.createEl("p", {
			text: "A pin is permanent. That exact version will stay public at its own address forever, even if you edit or withdraw this item later. There is no unpin.",
		});
		new Setting(this.contentEl).setName("Version").addDropdown((d) => {
			for (const v of candidates) d.addOption(String(v.version), `v${v.version} · ${v.at.slice(0, 10)}${v.note ? ` · ${v.note}` : ""}`);
			d.setValue(String(version));
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
		private folder: string,
	) {
		super(app);
	}

	onOpen() {
		this.modalEl.addClass("blyg-modal");
		this.setTitle(`Copy "${this.name}" into ${this.folder}`);
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

/** Deploy: check the live site, re-scan everything, then upload on confirm. */
export class DeployModal extends Modal {
	constructor(
		app: App,
		private plugin: BlygPublisherPlugin,
	) {
		super(app);
	}

	async onOpen() {
		const { contentEl } = this;
		const plan = this.plugin.deployPlanner();
		this.modalEl.addClass("blyg-modal");
		this.setTitle(`Deploy to ${plan.origin}`);
		const status = contentEl.createEl("p", { text: "Checking what's live right now…" });

		const check = await plan.check();
		status.remove();
		const list = contentEl.createEl("ul", { cls: "blyg-checks" });
		for (const p of check.problems) list.createEl("li", { cls: "bad", text: p });

		let needFirstDeployOk = false;
		if (check.live === "none") {
			list.createEl("li", { cls: "warn", text: `No blyg is live at ${plan.origin} yet.` });
			needFirstDeployOk = check.previousDeploys > 0;
		} else if (check.live === "unreachable") {
			list.createEl("li", { cls: "warn", text: `Couldn't reach ${plan.origin} (${check.error}). Normal before the domain is connected to Cloudflare Pages.` });
			needFirstDeployOk = true;
		} else {
			list.createEl("li", { cls: "ok", text: `Live site checked: ${check.liveItems} item(s). Nothing would roll back.` });
		}
		const c = check.comparison;
		list.createEl("li", {
			cls: "ok",
			text: `This deploy: ${c.newItems} new item(s), ${c.newVersions} new version(s), ${c.withdrawals} withdrawal(s), ${c.newPins} new pin(s). ${check.fileCount} files in all.`,
		});

		const confirmed = check.flags.map(() => false);
		let firstOk = !needFirstDeployOk;
		let btn: ButtonComponent;
		const update = () => btn.setDisabled(check.problems.length > 0 || !firstOk || confirmed.some((x) => !x));

		if (check.flags.length) {
			const box = contentEl.createDiv({ cls: "blyg-flags" });
			box.createEl("h4", { text: `Name scan across the whole site: ${check.flags.length} match(es) to review` });
			box.createEl("p", { cls: "blyg-tiny", text: "Your name list may have grown since these were published. Confirm each, or cancel and withdraw or edit the item." });
			check.flags.forEach((f, i) =>
				new Setting(box)
					.setName(`"${f.term}" in ${f.where}`)
					.setDesc(f.excerpt)
					.addToggle((t) =>
						t.onChange((v) => {
							confirmed[i] = v;
							update();
						}),
					),
			);
		}
		if (needFirstDeployOk) {
			new Setting(contentEl)
				.setName(check.previousDeploys ? "Deploy anyway" : "This is the first deploy")
				.setDesc(check.previousDeploys ? "You've deployed before, but the live site can't be checked. Only continue if you know why." : "Nothing can be compared yet.")
				.addToggle((t) =>
					t.onChange((v) => {
						firstOk = v;
						update();
					}),
				);
		}

		const log = contentEl.createEl("pre", { cls: "blyg-log" });
		log.hide();
		const foot = contentEl.createDiv({ cls: "blyg-foot" });
		foot.createSpan({ cls: "blyg-tiny", text: "Uploads with Cloudflare's own tool (wrangler), using its saved login." });
		new ButtonComponent(foot).setButtonText("Close").onClick(() => this.close());
		btn = new ButtonComponent(foot)
			.setButtonText("Deploy")
			.setCta()
			.onClick(async () => {
				btn.setDisabled(true);
				log.show();
				log.setText("");
				const res = await plan.deploy((chunk) => {
					log.appendText(chunk);
					log.scrollTop = log.scrollHeight;
				});
				if (res.ok) {
					btn.setButtonText("Deployed");
					log.appendText(`\nDone. ${res.url ? `Preview: ${res.url}\n` : ""}Live at ${plan.origin} (may take a minute).\n`);
				} else {
					log.appendText(`\nDeploy failed. ${res.hint ?? ""}\n`);
					btn.setDisabled(false);
				}
			});
		update();
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** One-time reset of test publishes. Only offered before anything has been deployed. */
export class ResetModal extends Modal {
	constructor(
		app: App,
		private onConfirm: () => Promise<void>,
		private count: number,
		private folder: string,
	) {
		super(app);
	}

	onOpen() {
		this.modalEl.addClass("blyg-modal");
		this.setTitle("Start over before the first deploy");
		this.contentEl.createEl("p", {
			text: `This clears the ledger's ${this.count} item(s) and removes blyg_id from notes in ${this.folder}, so everything can be published fresh as v1. Your notes and their text are not changed. The old ledger is kept in the backups folder.`,
		});
		this.contentEl.createEl("p", { cls: "blyg-tiny", text: "Only possible because nothing has been deployed yet. After the first deploy, published items can only be withdrawn." });
		let btn: ButtonComponent;
		new Setting(this.contentEl).setName("I understand").addToggle((t) => t.onChange((v) => btn.setDisabled(!v)));
		const foot = this.contentEl.createDiv({ cls: "blyg-foot" });
		new ButtonComponent(foot).setButtonText("Cancel").onClick(() => this.close());
		btn = new ButtonComponent(foot)
			.setButtonText("Start over")
			.setWarning()
			.setDisabled(true)
			.onClick(async () => {
				btn.setDisabled(true);
				await this.onConfirm();
				this.close();
			});
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * A private look at one version from the ledger: its text, what changed from
 * the version before, and whether (and where) it's public. Only the live
 * version and pinned versions are public; the rest exist only in the ledger.
 */
export class VersionModal extends Modal {
	constructor(
		app: App,
		private plugin: BlygPublisherPlugin,
		private item: LedgerItem,
		private version: number,
	) {
		super(app);
	}

	onOpen() {
		this.render();
	}

	private render() {
		const { contentEl, item } = this;
		contentEl.empty();
		this.modalEl.addClass("blyg-modal");
		const ctx = this.plugin.context!;
		const v = item.versions.find((x) => x.version === this.version)!;
		const i = item.versions.indexOf(v);
		const prev = i > 0 ? item.versions[i - 1] : null;
		const latest = latestVersion(item);
		const isLive = v === latest && v.kind !== "withdrawn";
		const lastDeploy = this.plugin.deploys.at(-1)?.at;
		const deployed = !!lastDeploy && lastDeploy !== "unknown" && v.at <= lastDeploy;
		const name = v.title ?? latestVersion(item).title ?? ctx.index.byId.get(item.id)?.[0]?.basename ?? item.id;

		this.setTitle(`v${v.version} of "${name}"`);
		contentEl.createDiv({
			cls: "blyg-sub",
			text: `${item.authored === "thread" ? "Thread" : "Fragment"} · ${v.at.slice(0, 16).replace("T", " ")} UTC${v.note ? ` · "${v.note}"` : ""}`,
		});

		const status = contentEl.createEl("ul", { cls: "blyg-checks" });
		if (v.kind === "withdrawn") status.createEl("li", { cls: "warn", text: "This version is the withdrawal. The item shows as withdrawn on your site." });
		else if (isLive) status.createEl("li", { cls: "ok", text: deployed ? "Current version: public on your site." : "Current version: public after your next deploy." });
		if (v.pinned) status.createEl("li", { cls: "ok", text: `Pinned: public permanently${deployed ? "" : " after your next deploy"}, at its own address.` });
		if (!isLive && !v.pinned && v.kind !== "withdrawn") {
			status.createEl("li", { cls: "warn", text: "Private: only in your ledger. Readers can't see older versions unless you pin them." });
		}

		const cols = contentEl.createDiv({ cls: "blyg-cols" });
		const text = cols.createDiv({ cls: "blyg-pane" });
		text.createEl("h4", { text: `v${v.version} as published` });
		const body = text.createDiv({ cls: "blyg-public" });
		if (v.kind === "withdrawn") body.createEl("p", { cls: "blyg-tiny", text: "(No text: withdrawn.)" });
		else {
			if (item.authored === "fragment" && v.title) body.createEl("h2", { cls: "blyg-public-title", text: v.title });
			body.append(sanitizeHTMLToDom(v.content_html));
		}

		const changes = cols.createDiv({ cls: "blyg-pane" });
		changes.createEl("h4", { text: prev ? `Changes from v${prev.version}` : "First version" });
		const diffEl = changes.createDiv({ cls: "blyg-diff" });
		if (prev) {
			if ((prev.title ?? "") !== (v.title ?? "") && item.authored === "fragment") {
				const t = diffEl.createDiv({ cls: "blyg-tiny" });
				t.createSpan({ text: "Title: " });
				if (prev.title) t.createEl("del", { text: prev.title });
				if (v.title) t.createEl("ins", { text: v.title });
			}
			for (const part of diffText(idsToNames(prev.content_md, ctx.index), idsToNames(v.content_md, ctx.index))) {
				diffEl.createEl(part.type === "add" ? "ins" : part.type === "del" ? "del" : "span", { text: part.text });
			}
		} else {
			diffEl.createSpan({ text: idsToNames(v.content_md, ctx.index) });
		}

		const foot = contentEl.createDiv({ cls: "blyg-foot" });
		const nav = foot.createDiv({ cls: "blyg-btn-row" });
		new ButtonComponent(nav).setButtonText("← Older").setDisabled(i === 0).onClick(() => {
			this.version = item.versions[i - 1].version;
			this.render();
		});
		new ButtonComponent(nav).setButtonText("Newer →").setDisabled(i === item.versions.length - 1).onClick(() => {
			this.version = item.versions[i + 1].version;
			this.render();
		});
		foot.createSpan({ cls: "blyg-tiny" });
		const publicUrl = ctx.origin && deployed ? (v.pinned ? `${ctx.origin}${pagePath(item)}v${v.version}/` : isLive ? `${ctx.origin}${pagePath(item)}` : null) : null;
		if (publicUrl) {
			const a = foot.createEl("a", { text: "View on site ↗", href: publicUrl });
			a.setAttr("target", "_blank");
		}
		const s = this.plugin.status;
		if (!v.pinned && v.kind !== "withdrawn" && s.state === "marked" && s.item?.id === item.id) {
			new ButtonComponent(foot).setButtonText(`Pin v${v.version}…`).onClick(() => {
				this.close();
				new PinModal(this.app, this.plugin, s, v.version).open();
			});
		}
		new ButtonComponent(foot).setButtonText("Close").onClick(() => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}
}
