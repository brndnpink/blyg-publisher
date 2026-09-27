// The Blyg panel in the right sidebar. It always shows the note being edited.

import { ItemView, WorkspaceLeaf } from "obsidian";
import { latestVersion } from "./core/ledger";
import { plainTextFromHtml } from "./core/markdown";
import type BlygPublisherPlugin from "./main";
import type { NoteStatus } from "./status";

export const VIEW_TYPE = "blyg-panel";

export class BlygPanel extends ItemView {
	private search = "";

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: BlygPublisherPlugin,
	) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE;
	}
	getDisplayText() {
		return "Blyg";
	}
	getIcon() {
		return "feather";
	}

	async onOpen() {
		await this.plugin.refresh();
	}

	render(status: NoteStatus) {
		const root = this.contentEl;
		root.empty();
		root.addClass("blyg-panel");
		const ctx = this.plugin.context;

		const head = root.createDiv({ cls: "blyg-site" });
		head.createEl("b", { text: ctx?.origin ? ctx.origin.replace(/^https:\/\//, "").replace(/\/$/, "") : "Blyg" });

		if (status.state === "none") {
			root.createDiv({ cls: "blyg-card" }).createEl("p", { text: "Open a note to see its publishing status." });
		} else if (status.state === "private") {
			const card = this.card(root, "This note");
			card.createEl("p").append(
				createEl("b", { text: "This note is private. " }),
				`Blyg Publisher can't publish anything outside ${this.plugin.root.folder}.`,
			);
			this.button(card, "Promote a copy to Blyg…", () => this.plugin.promote(status.file));
			card.createEl("p", { cls: "blyg-tiny", text: `Makes a new copy in ${this.plugin.root.folder} for you to edit. The original stays private and untouched.` });
		} else if (status.state === "unmarked") {
			const card = this.card(root, "This note");
			card.createEl("p").append(createEl("b", { text: "Not marked for publishing. " }), "It stays private until you choose a kind.");
			const row = card.createDiv({ cls: "blyg-btn-row" });
			this.button(row, "Make fragment", () => this.plugin.markNote(status.file, "fragment"));
			this.button(row, "Make thread", () => this.plugin.markNote(status.file, "thread"));
			card.createEl("p", { cls: "blyg-tiny", text: "Adds blyg: publish and the kind to the note's properties." });
		} else {
			this.renderMarked(root, status);
		}

		this.renderSite(root);
	}

	private renderMarked(root: HTMLElement, s: Extract<NoteStatus, { state: "marked" }>) {
		const { check, latest, item } = s;
		const card = this.card(root, "This note");
		const row = card.createDiv({ cls: "blyg-row" });
		row.createSpan({ cls: "blyg-kind", text: check.kind ?? item?.authored ?? "?" });
		let state = "never published";
		if (latest?.kind === "withdrawn") state = `withdrawn (v${latest.version})`;
		else if (latest) state = s.edited ? `v${latest.version} live · edited since` : `v${latest.version} live · up to date`;
		row.createSpan({ cls: s.edited ? "blyg-state edited" : "blyg-state", text: state });
		if (check.title) card.createDiv({ cls: "blyg-title", text: check.title, attr: { title: "Public title. Set a blyg_title property to change it." } });

		if (check.kind === "fragment") {
			const n = check.publicMarkdown.length;
			const meter = card.createDiv({ cls: "blyg-meter" });
			meter.createEl("i", { attr: { style: `width:${Math.min(100, (n / 2000) * 100)}%` }, cls: n > 1000 ? "over" : "" });
			const lab = card.createDiv({ cls: "blyg-row blyg-tiny" });
			lab.createSpan({ text: `${n.toLocaleString()} / 1,000 recommended` });
			lab.createSpan({ text: "2,000 max" });
		}

		const list = card.createEl("ul", { cls: "blyg-checks" });
		for (const b of s.blockers) list.createEl("li", { cls: "bad", text: b });
		if (!s.blockers.length) list.createEl("li", { cls: "ok", text: "All safety checks pass" });
		if (check.flags.length) {
			list.createEl("li", { cls: "warn", text: `Name scan: ${check.flags.length} match${check.flags.length === 1 ? "" : "es"} to review when you publish` });
		}
		for (const w of check.warnings) list.createEl("li", { cls: "warn", text: w });
		if (s.staleEmbeds) list.createEl("li", { cls: "warn", text: `${s.staleEmbeds} embedded fragment(s) have newer versions; republish to update them` });

		const canPublish = !s.blockers.length && (s.edited || s.staleEmbeds > 0);
		const label = s.blockers.length
			? `Fix ${s.blockers.length} problem${s.blockers.length === 1 ? "" : "s"} to publish`
			: canPublish
				? `Preview & publish v${s.nextVersion}…`
				: `No changes since v${latest!.version}`;
		this.button(card, label, () => this.plugin.openPublish(), { cta: true, disabled: !canPublish });

		if (item) {
			const btns = card.createDiv({ cls: "blyg-btn-row" });
			const pinnable = item.versions.some((v) => v.kind !== "withdrawn" && !v.pinned);
			this.button(btns, "Pin…", () => this.plugin.openPin(), { disabled: !pinnable || s.blockers.length > 0 });
			this.button(btns, "Withdraw…", () => this.plugin.openWithdraw(), {
				warning: true,
				disabled: latestVersion(item).kind === "withdrawn" || this.plugin.context!.global.length > 0,
			});

			const vcard = this.card(root, "Versions");
			const ul = vcard.createEl("ul", { cls: "blyg-versions" });
			if (s.edited && latest?.kind !== "withdrawn") {
				const li = ul.createEl("li");
				li.createSpan({ cls: "v", text: `v${s.nextVersion}` });
				li.createSpan({ cls: "d", text: "not yet published" });
				li.createSpan({ cls: "draft", text: "draft" });
			}
			for (const v of [...item.versions].reverse()) {
				const li = ul.createEl("li", { cls: "blyg-clickable", attr: { title: `View v${v.version}` } });
				li.onclick = () => this.plugin.openVersion(item, v.version);
				li.createSpan({ cls: "v", text: `v${v.version}` });
				li.createSpan({ cls: "d", text: `${v.at.slice(0, 10)}${v.kind === "withdrawn" ? " · withdrawn" : ""}${v.note ? ` · "${v.note}"` : ""}` });
				li.createSpan({ cls: v.pinned ? "pin" : "", text: v.pinned ? "◆ pinned" : "" });
			}
		}

		if (check.kind === "thread") this.renderPicker(root);
	}

	private renderPicker(root: HTMLElement) {
		const ctx = this.plugin.context!;
		const card = this.card(root, "Embed a fragment");
		const input = card.createEl("input", { cls: "blyg-search", attr: { type: "search", placeholder: "Search published fragments…" } });
		input.value = this.search;
		const list = card.createDiv();
		const draw = () => {
			list.empty();
			const q = this.search.toLowerCase();
			const rows = Object.values(ctx.ledger.items)
				.filter((it) => it.authored === "fragment" && latestVersion(it).kind === "fragment")
				.map((it) => ({ it, file: ctx.index.byId.get(it.id)?.[0] }))
				.filter((r) => r.file)
				.map((r) => ({ ...r, text: plainTextFromHtml(latestVersion(r.it).content_html) }))
				.filter((r) => !q || r.text.toLowerCase().includes(q) || r.file!.basename.toLowerCase().includes(q))
				.sort((a, b) => latestVersion(b.it).at.localeCompare(latestVersion(a.it).at))
				.slice(0, 30);
			if (!rows.length) list.createEl("p", { cls: "blyg-tiny", text: q ? "No matches." : "No published fragments yet." });
			for (const r of rows) {
				const row = list.createDiv({ cls: "blyg-frag" });
				row.createSpan({ text: r.file!.basename, attr: { title: r.text } });
				row.createEl("a", { text: "insert" }).onclick = () => this.plugin.insertEmbed(r.file!);
			}
		};
		input.oninput = () => {
			this.search = input.value;
			draw();
		};
		draw();
		card.createEl("p", { cls: "blyg-tiny", text: "Puts ![[Note name]] on its own line at your cursor (with its folder path if another note shares the name). It becomes the fragment's id when you publish." });
	}

	private renderSite(root: HTMLElement) {
		const ctx = this.plugin.context;
		if (!ctx) return;
		const card = this.card(root, "Site");
		const items = Object.values(ctx.ledger.items);
		const live = items.filter((i) => latestVersion(i).kind !== "withdrawn").length;
		card.createDiv({ text: `${live} live item${live === 1 ? "" : "s"}${items.length > live ? `, ${items.length - live} withdrawn` : ""} in the ledger` });
		const list = card.createEl("ul", { cls: "blyg-checks" });
		for (const g of ctx.global) list.createEl("li", { cls: "bad", text: g });
		if (ctx.orphans.length) {
			list.createEl("li", {
				cls: "warn",
				text: `${ctx.orphans.length} published item(s) have no note in ${this.plugin.root.folder} (deleted or renamed outside Obsidian?). They stay public until withdrawn.`,
			});
		}
		const last = this.plugin.deploys.at(-1);
		card.createEl("p", {
			cls: "blyg-tiny",
			text: last ? `Last deployed ${last.at === "unknown" ? "(date unknown)" : last.at.slice(0, 16).replace("T", " ") + " UTC"}.` : "Never deployed. Publishing records versions in the ledger; deploying puts them online.",
		});
		const host = ctx.origin ? new URL(ctx.origin).host : "the web";
		this.button(card, `Deploy to ${host}…`, () => this.plugin.openDeploy(), { disabled: ctx.global.length > 0 });
		const links = card.createDiv({ cls: "blyg-row blyg-tiny" });
		if (ctx.origin && last) links.createEl("a", { text: "View blyg ↗", href: ctx.origin });
		if (ctx.origin && last) links.createEl("a", { text: "Feed ↗", href: `${ctx.origin}feed.xml` });
		if (!last && items.length) links.createEl("a", { text: "Start over…" }).onclick = () => this.plugin.openReset();
		links.createEl("a", { text: "Settings" }).onclick = () => this.plugin.openSettings();
	}

	private card(root: HTMLElement, title: string) {
		const c = root.createDiv({ cls: "blyg-card" });
		c.createEl("h3", { text: title });
		return c;
	}

	private button(parent: HTMLElement, text: string, onClick: () => void, opts: { cta?: boolean; warning?: boolean; disabled?: boolean } = {}) {
		const b = parent.createEl("button", { text, cls: ["blyg-btn", opts.cta ? "mod-cta" : "", opts.warning ? "mod-warning" : ""].filter(Boolean) });
		b.disabled = !!opts.disabled;
		b.onclick = onClick;
		return b;
	}
}
