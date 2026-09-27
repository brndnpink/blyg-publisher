// Ledger persistence: <publish folder>/.blyg/ledger.json, with a backup before every
// write, a read-back check after it, and refusal of any change that would
// break a protocol promise. Pure except for the injected file adapter, so it
// can be tested without Obsidian.

import { checkLedger, checkTransition, emptyLedger } from "./core/ledger";
import type { Ledger, Result } from "./core/types";

export interface FileAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	mkdir(path: string): Promise<void>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
	remove(path: string): Promise<void>;
}

const KEEP_BACKUPS = 30;

export class LedgerStore {
	readonly path: string;
	readonly backupDir: string;

	constructor(
		private adapter: FileAdapter,
		private dir: string,
		private now: () => Date = () => new Date(),
	) {
		this.path = `${dir}/ledger.json`;
		this.backupDir = `${dir}/backups`;
	}

	/** The ledger as it is on disk right now (Dropbox may have synced a newer one from another Mac). */
	async load(): Promise<Ledger> {
		if (!(await this.adapter.exists(this.path))) return emptyLedger();
		const ledger = JSON.parse(await this.adapter.read(this.path)) as Ledger;
		const problems = checkLedger(ledger);
		if (problems.length) throw new Error(`The ledger file is damaged: ${problems.slice(0, 3).join("; ")}`);
		return ledger;
	}

	/**
	 * Files next to the ledger that look like sync conflicts ("conflicted copy",
	 * or Dropbox's "ledger 2.json"). While any exist, two Macs have disagreed
	 * about the published history and publishing must stop until it's resolved.
	 */
	async conflicts(): Promise<string[]> {
		if (!(await this.adapter.exists(this.dir))) return [];
		const { files } = await this.adapter.list(this.dir);
		return files.filter((f) => {
			const name = f.split("/").pop() ?? "";
			return /^ledger.*\.json$/i.test(name) && name !== "ledger.json" && name !== "ledger.json.tmp";
		});
	}

	/**
	 * Apply one operation to the freshest ledger on disk and save the result,
	 * refusing if the new ledger is inconsistent or would break a promise
	 * already made (checkTransition).
	 */
	async update<T extends { ledger: Ledger }>(op: (ledger: Ledger) => Promise<Result<T>> | Result<T>): Promise<Result<T>> {
		const conflicts = await this.conflicts();
		if (conflicts.length) {
			return { ok: false, errors: [`Sync conflict in the ledger folder (${conflicts.join(", ")}). Resolve it before publishing.`] };
		}
		const current = await this.load();
		const result = await op(current);
		if (!result.ok || result.ledger === current) return result;

		const problems = [...checkLedger(result.ledger), ...checkTransition(current, result.ledger)];
		if (problems.length) return { ok: false, errors: problems };

		await this.save(current, result.ledger);
		return result;
	}

	private async save(previous: Ledger, next: Ledger): Promise<void> {
		if (!(await this.adapter.exists(this.dir))) await this.adapter.mkdir(this.dir);
		if (!(await this.adapter.exists(this.backupDir))) await this.adapter.mkdir(this.backupDir);

		if (Object.keys(previous.items).length) {
			const stamp = this.now().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
			await this.adapter.write(`${this.backupDir}/ledger-${stamp}.json`, serialize(previous));
			await this.pruneBackups();
		}

		const data = serialize(next);
		await this.adapter.write(this.path, data);
		if ((await this.adapter.read(this.path)) !== data) {
			throw new Error("The ledger didn't save correctly. The previous version is in the backups folder.");
		}
	}

	private async pruneBackups(): Promise<void> {
		const { files } = await this.adapter.list(this.backupDir);
		const backups = files.filter((f) => /ledger-\d{8}T\d{6}Z\.json$/.test(f)).sort();
		for (const old of backups.slice(0, Math.max(0, backups.length - KEEP_BACKUPS))) {
			await this.adapter.remove(old);
		}
	}
}

export function serialize(ledger: Ledger): string {
	return JSON.stringify(ledger, null, 2) + "\n";
}
