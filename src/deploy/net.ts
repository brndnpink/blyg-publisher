// The plugin's only HTTP client: reads the live blyg's public files.
import { requestUrl } from "obsidian";
import type { Getter } from "./live";

export const obsidianGet: Getter = async (url) => {
	const r = await requestUrl({ url, method: "GET", throw: false, headers: { "Cache-Control": "no-cache" } });
	return { status: r.status, text: r.text };
};
