// A record of every deploy, kept next to the ledger. It tells the panel when
// the site was last updated and guards the one-time "start over" reset.

import type { FileAdapter } from "./store";

export interface DeployRecord {
	at: string;
	origin: string;
	url: string | null;
	items: number;
	files: number;
}


export async function readDeploys(adapter: FileAdapter, stateDir: string): Promise<DeployRecord[]> {
	const PATH = `${stateDir}/deploys.json`;
	if (!(await adapter.exists(PATH))) return [];
	try {
		return JSON.parse(await adapter.read(PATH)) as DeployRecord[];
	} catch {
		// Unreadable history must not look like "never deployed" (that would unlock the reset).
		return [{ at: "unknown", origin: "", url: null, items: 0, files: 0 }];
	}
}

export async function recordDeploy(adapter: FileAdapter, stateDir: string, rec: DeployRecord): Promise<void> {
	const PATH = `${stateDir}/deploys.json`;
	const all = await readDeploys(adapter, stateDir);
	all.push(rec);
	if (!(await adapter.exists(stateDir))) await adapter.mkdir(stateDir);
	await adapter.write(PATH, JSON.stringify(all, null, 2) + "\n");
}
