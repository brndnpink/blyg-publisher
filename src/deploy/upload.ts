// Upload via Cloudflare's own CLI (wrangler), which keeps its login in its
// own config outside the vault. The plugin never sees a token.

import { spawn } from "child_process";

export interface UploadResult {
	ok: boolean;
	output: string;
	/** The deployment's *.pages.dev URL, if wrangler printed one. */
	url: string | null;
}

const PROJECT = /^[a-z0-9][a-z0-9-]{0,56}[a-z0-9]$/;

function shellQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function uploadCommand(dir: string, project: string): string {
	if (!PROJECT.test(project)) throw new Error(`"${project}" isn't a valid Cloudflare Pages project name (lowercase letters, digits, hyphens).`);
	return `npx --yes wrangler@4 pages deploy ${shellQuote(dir)} --project-name ${shellQuote(project)} --branch main --commit-dirty=true`;
}

/**
 * Runs in a login shell so it finds the same node/npx as Terminal does.
 * CI=true keeps wrangler from waiting on interactive prompts (for example,
 * when it isn't logged in); it fails with a message instead.
 */
export function upload(dir: string, project: string, onOutput: (chunk: string) => void, timeoutMs = 5 * 60_000): Promise<UploadResult> {
	const cmd = uploadCommand(dir, project);
	return new Promise((resolveResult) => {
		let output = "";
		const child = spawn("/bin/zsh", ["-lc", cmd], { env: { ...process.env, CI: "true", FORCE_COLOR: "0", NO_COLOR: "1" } });
		const take = (b: Buffer) => {
			const s = b.toString().replace(/\x1b\[[0-9;]*m/g, "");
			output += s;
			onOutput(s);
		};
		child.stdout.on("data", take);
		child.stderr.on("data", take);
		const timer = setTimeout(() => {
			child.kill();
			output += "\nTimed out after 5 minutes.";
		}, timeoutMs);
		child.on("close", (code) => {
			clearTimeout(timer);
			const url = /https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev\S*/i.exec(output)?.[0] ?? null;
			resolveResult({ ok: code === 0, output, url });
		});
		child.on("error", (e) => {
			clearTimeout(timer);
			resolveResult({ ok: false, output: `${output}\n${e.message}`, url: null });
		});
	});
}
