import { debounce, MarkdownView, normalizePath, Plugin, TFile, type Debouncer } from "obsidian";
import { pin, publish, withdraw } from "./core/ledger";
import { toIso } from "./core/util";
import { DeployModal, notice, PinModal, PromoteModal, PublishModal, ResetModal, VersionModal, WithdrawModal } from "./modals";
import type { LedgerItem } from "./core/types";
import { makePlanner } from "./deployflow";
import { readDeploys, type DeployRecord } from "./deploys";
import { fetchLive } from "./deploy/live";
import { obsidianGet } from "./deploy/net";
import { BlygPanel, VIEW_TYPE } from "./panel";
import { splitFrontmatter } from "./safety/clean";
import { PUBLISH_ROOT } from "./safety/root";
import { BlygSettingTab, DEFAULT_SETTINGS, type BlygSettings } from "./settings";
import { loadContext, noteStatus, type Context, type NoteStatus } from "./status";
import { LedgerStore } from "./store";

type Marked = Extract<NoteStatus, { state: "marked" }>;

export default class BlygPublisherPlugin extends Plugin {
	settings: BlygSettings = { ...DEFAULT_SETTINGS };
	store!: LedgerStore;
	context: Context | null = null;
	status: NoteStatus = { state: "none" };
	deploys: DeployRecord[] = [];
	/** The note being edited, remembered even while the sidebar has focus. */
	private currentFile: TFile | null = null;
	private statusBar!: HTMLElement;
	private scheduleRefresh!: Debouncer<[], void>;
	private refreshing: Promise<void> | null = null;

	async onload() {
		await this.loadSettings();
		this.store = new LedgerStore(this.app.vault.adapter);
		this.statusBar = this.addStatusBarItem();
		this.statusBar.addClass("blyg-statusbar");
		this.addSettingTab(new BlygSettingTab(this.app, this));
		this.registerView(VIEW_TYPE, (leaf) => new BlygPanel(leaf, this));
		this.addRibbonIcon("feather", "Open Blyg panel", () => this.activatePanel());

		this.scheduleRefresh = debounce(() => void this.refresh(), 400, true);
		this.currentFile = this.app.workspace.getActiveFile();
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file) this.currentFile = file;
				this.scheduleRefresh();
			}),
		);
		this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("modify", () => this.scheduleRefresh()));
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (this.currentFile?.path === oldPath && file instanceof TFile) this.currentFile = file;
				this.scheduleRefresh();
			}),
		);
		this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));

		this.addCommand({ id: "open-panel", name: "Open Blyg panel", callback: () => this.activatePanel() });
		this.addCommand({ id: "publish", name: "Preview and publish current note…", callback: () => this.openPublish() });
		this.addCommand({ id: "pin", name: "Pin a version of current note…", callback: () => this.openPin() });
		this.addCommand({ id: "withdraw", name: "Withdraw current note…", callback: () => this.openWithdraw() });
		this.addCommand({
			id: "promote",
			name: "Promote a copy of current note to Blyg…",
			callback: () => this.currentFile && this.promote(this.currentFile),
		});
		this.addCommand({
			id: "make-fragment",
			name: "Mark current note as a fragment",
			callback: () => this.currentFile && this.markNote(this.currentFile, "fragment"),
		});
		this.addCommand({ id: "deploy", name: "Deploy site…", callback: () => this.openDeploy() });
		this.addCommand({ id: "start-over", name: "Start over: clear test publishes (before first deploy only)…", callback: () => this.openReset() });
		this.addCommand({
			id: "make-thread",
			name: "Mark current note as a thread",
			callback: () => this.currentFile && this.markNote(this.currentFile, "thread"),
		});

		this.app.workspace.onLayoutReady(() => void this.refresh());
	}

	async loadSettings() {
		this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<BlygSettings> | null) };
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.scheduleRefresh();
	}

	openSettings() {
		// Not in the public typings, but stable and widely used.
		const setting = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
		setting.open();
		setting.openTabById(this.manifest.id);
	}

	/** Recompute context and the current note's status, then redraw. Serialized so refreshes don't interleave. */
	async refresh(): Promise<void> {
		while (this.refreshing) await this.refreshing;
		this.refreshing = (async () => {
			try {
				this.context = await loadContext(this.app, this.store, this.settings, this.manifest.version);
				this.deploys = await readDeploys(this.app.vault.adapter);
				const file = this.currentFile && this.app.vault.getAbstractFileByPath(this.currentFile.path) instanceof TFile ? this.currentFile : null;
				this.status = await noteStatus(this.app, file, this.context);
			} catch (e) {
				console.error("Blyg Publisher refresh failed", e);
			}
			this.renderStatusBar();
			for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
				if (leaf.view instanceof BlygPanel) leaf.view.render(this.status);
			}
		})();
		try {
			await this.refreshing;
		} finally {
			this.refreshing = null;
		}
	}

	private renderStatusBar() {
		const s = this.status;
		this.statusBar.empty();
		if (s.state !== "marked") return;
		const text = !s.latest
			? "Blyg: never published"
			: s.latest.kind === "withdrawn"
				? "Blyg: withdrawn"
				: `Blyg: v${s.latest.version} published${s.edited ? " · edited since" : ""}`;
		this.statusBar.createSpan({ text, cls: s.edited && s.latest ? "edited" : "" });
		this.statusBar.onclick = () => void this.activatePanel();
	}

	async activatePanel() {
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			const right = this.app.workspace.getRightLeaf(false);
			if (!right) return;
			await right.setViewState({ type: VIEW_TYPE, active: true });
			leaf = right;
		}
		await this.app.workspace.revealLeaf(leaf);
		await this.refresh();
	}

	/** Fresh status for the current note, or an explanation of why it can't be acted on. */
	private async markedStatus(): Promise<Marked | null> {
		await this.refresh();
		const s = this.status;
		if (s.state === "none") notice("Open a note first.");
		else if (s.state === "private") notice(`This note is outside ${PUBLISH_ROOT} and can't be published.`);
		else if (s.state === "unmarked") notice("This note isn't marked for publishing yet.");
		return s.state === "marked" ? s : null;
	}

	async openPublish() {
		const s = await this.markedStatus();
		if (!s) return;
		if (s.blockers.length) return notice(`Can't publish yet: ${s.blockers[0]}`);
		if (!s.edited && !s.staleEmbeds) return notice(`No changes since v${s.latest!.version}.`);
		new PublishModal(this.app, this, s).open();
	}

	async openPin() {
		const s = await this.markedStatus();
		if (!s) return;
		if (!s.item) return notice("Publish this note before pinning a version.");
		if (s.blockers.length) return notice(`Can't pin right now: ${s.blockers[0]}`);
		new PinModal(this.app, this, s).open();
	}

	async openWithdraw() {
		const s = await this.markedStatus();
		if (!s) return;
		if (!s.item) return notice("This note has never been published.");
		if (s.item.versions.at(-1)!.kind === "withdrawn") return notice("Already withdrawn.");
		new WithdrawModal(this.app, this, s).open();
	}

	/**
	 * Called by the publish window after the author confirms. Re-checks the
	 * note first: if its public text changed since the preview, nothing is
	 * published and the author reviews again.
	 */
	async publishNote(previewed: Marked, note: string): Promise<boolean> {
		await this.refresh();
		const now = this.status;
		if (now.state !== "marked" || now.file.path !== previewed.file.path || now.check.publicMarkdown !== previewed.check.publicMarkdown || now.check.title !== previewed.check.title) {
			notice("The note changed after the preview. Nothing was published; review it again.");
			return false;
		}
		if (now.blockers.length) {
			notice(`Nothing was published: ${now.blockers[0]}`);
			return false;
		}
		const at = toIso();
		const result = await this.store.update((ledger) =>
			publish(ledger, { id: now.item?.id, kind: now.check.kind!, content_md: now.check.publicMarkdown, title: now.check.title, note: note || null }, at),
		);
		if (!result.ok) {
			notice(`Nothing was published: ${result.errors.join("; ")}`, 10000);
			return false;
		}
		if (!now.item) {
			try {
				await this.app.fileManager.processFrontMatter(now.file, (fm: Record<string, unknown>) => {
					fm.blyg_id = result.id;
				});
			} catch {
				notice(`Published, but couldn't save blyg_id to the note. Add this property by hand: blyg_id: ${result.id}`, 0);
			}
		}
		notice(result.changed ? `Published v${result.version}. It goes live on the next deploy.` : `No changes since v${result.version}.`);
		await this.refresh();
		return true;
	}

	async pinItem(id: string, version: number): Promise<boolean> {
		const result = await this.store.update((ledger) => pin(ledger, id, version));
		if (!result.ok) {
			notice(`Not pinned: ${result.errors.join("; ")}`, 10000);
			return false;
		}
		notice(`Pinned v${version}. It stays public permanently after the next deploy.`);
		await this.refresh();
		return true;
	}

	async withdrawItem(id: string, note: string | null): Promise<boolean> {
		const at = toIso();
		const result = await this.store.update((ledger) => withdraw(ledger, id, at, note));
		if (!result.ok) {
			notice(`Not withdrawn: ${result.errors.join("; ")}`, 10000);
			return false;
		}
		notice(`Withdrawn (v${result.version}). Readers drop it after the next deploy.`);
		await this.refresh();
		return true;
	}

	openVersion(item: LedgerItem, version: number) {
		new VersionModal(this.app, this, item, version).open();
	}

	deployPlanner() {
		return makePlanner(this);
	}

	async openDeploy() {
		await this.refresh();
		if (!this.settings.origin.trim()) return notice("Set your blyg's web address in settings first.");
		new DeployModal(this.app, this).open();
	}

	/**
	 * Before anything is public, test publishes can be cleared: no promise has
	 * been made to any reader yet. Refused once any deploy is recorded or a
	 * blyg is already live at the origin.
	 */
	async openReset() {
		await this.refresh();
		if (this.deploys.length) return notice("The site has been deployed, so the ledger can't be reset. Withdraw items instead.");
		const origin = this.context?.origin;
		if (origin) {
			const live = await fetchLive(origin, obsidianGet);
			if (live.kind === "live") return notice(`A blyg is already live at ${origin}, so the ledger can't be reset.`);
		}
		const count = Object.keys(this.context?.ledger.items ?? {}).length;
		if (!count) return notice("The ledger is already empty.");
		new ResetModal(
			this.app,
			async () => {
				const adapter = this.app.vault.adapter;
				const stamp = toIso().replace(/[-:]/g, "");
				if (!(await adapter.exists(this.store.backupDir))) await adapter.mkdir(this.store.backupDir);
				await adapter.rename(this.store.path, `${this.store.backupDir}/ledger-reset-${stamp}.json`);
				for (const path of this.context!.index.byPath.keys()) {
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) {
						await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
							delete fm.blyg_id;
						});
					}
				}
				notice("Ledger cleared. Notes keep their text and settings; publish them again to start at v1.", 10000);
				await this.refresh();
			},
			count,
		).open();
	}

	async markNote(file: TFile, kind: "fragment" | "thread") {
		if (!file.path.startsWith(`${PUBLISH_ROOT}/`)) return notice(`Only notes in ${PUBLISH_ROOT} can be marked.`);
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm.blyg = "publish";
			fm.blyg_kind = kind;
		});
		await this.refresh();
	}

	/** Copy a private note into 7 - Blyg, leaving the original untouched and its properties behind. */
	promote(file: TFile) {
		new PromoteModal(
			this.app,
			async (kind) => {
				const folder = normalizePath(`${PUBLISH_ROOT}/${kind}s`);
				if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
				let path = normalizePath(`${folder}/${file.basename}.md`);
				for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${folder}/${file.basename} ${i}.md`);
				const { body } = splitFrontmatter(await this.app.vault.read(file));
				const copy = await this.app.vault.create(path, body.replace(/^\n+/, ""));
				await this.app.workspace.getLeaf(false).openFile(copy);
				notice(
					`Copied to ${path}. The original is unchanged. Review it, then choose Make ${kind}.` +
						(copy.basename === file.basename
							? " The copy shares its name with the original; when linking or embedding it, use the Blyg panel so the link includes its folder."
							: ""),
					10000,
				);
			},
			file.basename,
		).open();
	}

	/**
	 * Insert a fragment embed on its own line at the cursor of the note being
	 * edited. Uses Obsidian's shortest unambiguous link text, so a fragment
	 * that shares its name with a private note (e.g. after Promote) gets its
	 * folder path and can't resolve to the private one.
	 */
	insertEmbed(fragment: TFile) {
		const leaf = this.app.workspace
			.getLeavesOfType("markdown")
			.find((l) => l.view instanceof MarkdownView && l.view.file?.path === this.currentFile?.path);
		const editor = leaf?.view instanceof MarkdownView ? leaf.view.editor : null;
		if (!leaf || !editor) return notice("Open the thread in an editor first.");
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const before = cursor.ch > 0 && line.slice(0, cursor.ch).trim() ? "\n\n" : "";
		const after = line.slice(cursor.ch).trim() ? "\n\n" : "\n";
		const link = this.app.metadataCache.fileToLinktext(fragment, this.currentFile!.path, true);
		editor.replaceSelection(`${before}![[${link}]]${after}`);
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
	}
}
