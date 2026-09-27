// Client for an existing blyg run by the Blygger reference server
// (github.com/blygger/blygger-spec, worker/). Publishing goes through its
// owner API; reading goes through the blyg's public files.
//
// Uses Node's https directly (desktop only) because the login answers with a
// redirect that carries the session cookie, and a redirect-following client
// would lose it. The password is sent once, to log in, and never stored;
// only the session cookie is kept (by the caller, in Obsidian's secret
// storage).

import { request as httpsRequest } from "https";
import { request as httpRequest } from "http";

export class SessionExpired extends Error {
	constructor() {
		super("Not logged in to the blyg, or the session expired. Log in again.");
	}
}

export interface ServerEndpoints {
	/** e.g. "https://example.com" */
	host: string;
	/** "" for a root mount, else "/blyg" */
	mount: string;
}

/** Where the reference server's studio and API live, from the blyg's public address. */
export function endpointsFor(origin: string): ServerEndpoints {
	const u = new URL(origin);
	return { host: u.origin, mount: u.pathname.replace(/\/+$/, "") };
}

interface RawResponse {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}

function send(method: string, url: string, headers: Record<string, string>, body?: string, timeoutMs = 30_000): Promise<RawResponse> {
	return new Promise((resolve, reject) => {
		const u = new URL(url);
		const req = (u.protocol === "http:" ? httpRequest : httpsRequest)(
			u,
			{ method, headers: { "User-Agent": "blyg-publisher", ...headers, ...(body !== undefined ? { "Content-Length": String(Buffer.byteLength(body)) } : {}) } },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
			},
		);
		req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timed out contacting ${u.host}`)));
		req.on("error", reject);
		if (body !== undefined) req.write(body);
		req.end();
	});
}

/**
 * Log in with the owner password. Returns the session cookie ("blyg_session=…")
 * or throws with a plain-language reason.
 */
export async function login(origin: string, password: string): Promise<string> {
	const { host, mount } = endpointsFor(origin);
	const res = await send(
		"POST",
		`${host}${mount}/studio/login`,
		{ "Content-Type": "application/x-www-form-urlencoded" },
		new URLSearchParams({ password }).toString(),
	);
	if (res.status === 403) throw new Error("Wrong password.");
	if (res.status === 404) throw new Error(`No blyg studio found at ${host}${mount}/studio. Is this a reference-server blyg?`);
	const setCookie = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
	const session = setCookie.map((c) => c.split(";")[0]).find((c) => c.startsWith("blyg_session="));
	if (!session) throw new Error(`Login didn't return a session (HTTP ${res.status}). This server may not be a Blygger reference server.`);
	return session;
}

export interface ServerClient {
	createItem(kind: "fragment" | "thread", content_md: string): Promise<string>;
	saveText(id: string, content_md: string): Promise<void>;
	publish(id: string, note: string | null): Promise<number>;
	pin(id: string, version: number): Promise<void>;
	withdraw(id: string, note: string | null): Promise<number>;
	/** Cheap authenticated call to check the session is still valid. */
	check(): Promise<void>;
}

export function makeServerClient(origin: string, cookie: string): ServerClient {
	const { host } = endpointsFor(origin);
	async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await send(
			method,
			`${host}/api${path}`,
			{ Cookie: cookie, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
			body !== undefined ? JSON.stringify(body) : undefined,
		);
		if (res.status === 401) throw new SessionExpired();
		let json: Record<string, unknown> = {};
		try {
			json = JSON.parse(res.body) as Record<string, unknown>;
		} catch {
			/* non-JSON error page */
		}
		if (res.status >= 400) {
			const detail = Array.isArray(json.errors)
				? (json.errors as { directive?: string; reason?: string }[]).map((e) => `${e.directive ?? ""} ${e.reason ?? ""}`.trim()).join("; ")
				: "";
			throw new Error(`${String(json.error ?? `HTTP ${res.status}`)}${detail ? `: ${detail}` : ""}`);
		}
		return json as T;
	}
	return {
		async createItem(kind, content_md) {
			const r = await api<{ id: string }>("POST", "/items", { kind, content_md });
			return r.id;
		},
		async saveText(id, content_md) {
			await api("PUT", `/items/${id}`, { content_md });
		},
		async publish(id, note) {
			const r = await api<{ version: number }>("POST", `/items/${id}/publish`, note ? { note } : {});
			return r.version;
		},
		async pin(id, version) {
			await api("POST", `/items/${id}/pin`, { version });
		},
		async withdraw(id, note) {
			const r = await api<{ version: number }>("POST", `/items/${id}/withdraw`, note ? { note } : {});
			return r.version;
		},
		async check() {
			// Unknown id: 404 means logged in, 401 means not.
			const res = await send("PUT", `${host}/api/items/00000000000000000000000000`, { Cookie: cookie, "Content-Type": "application/json" }, "{}");
			if (res.status === 401) throw new SessionExpired();
		},
	};
}
