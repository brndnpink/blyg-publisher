// A record of every deploy, kept next to the ledger. It tells the panel when
// the site was last updated and guards the one-time "start over" reset.

import type { FileAdapter } from "./store";
import { STATE_DIR } from "./safety/root";

export interface DeployRecord {
	at: string;
	origin: string;
	url: string | null;
	items: number;
	files: number;
}

const PATH = `${STATE_DIR}/deploys.json`;

export async function readDeploys(adapter: FileAdapter): Promise<DeployRecord[]> {
	if (!(await adapter.exists(PATH))) return [];
	try {
		return JSON.parse(await adapter.read(PATH)) as DeployRecord[];
	} catch {
		// Unreadable history must not look like "never deployed" (that would unlock the reset).
		return [{ at: "unknown", origin: "", url: null, items: 0, files: 0 }];
	}
}

export async function recordDeploy(adapter: FileAdapter, rec: DeployRecord): Promise<void> {
	const all = await readDeploys(adapter);
	all.push(rec);
	if (!(await adapter.exists(STATE_DIR))) await adapter.mkdir(STATE_DIR);
	await adapter.write(PATH, JSON.stringify(all, null, 2) + "\n");
}
