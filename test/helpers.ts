import { publish, type Ledger, type PublishInput, type SiteConfig } from "../src/core";

export const SITE: SiteConfig = {
	origin: "https://example.com/blyg/",
	title: "Example blyg",
	description: "Test blyg",
	author: { name: "Test Author", bio: "A bio", links: [] },
	generator: "blyg-publisher/test",
};

/** Deterministic ids: aaaa…01, aaaa…02, … (valid Crockford base32). */
export function idMaker() {
	let n = 0;
	return () => {
		n++;
		return "a".repeat(24) + String(n).padStart(2, "0");
	};
}

/** Minute-spaced timestamps from a fixed start. */
export function clock(start = "2026-09-01T12:00:00Z") {
	let t = Date.parse(start);
	return () => {
		const iso = new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
		t += 60_000;
		return iso;
	};
}

/** publish() that throws on error, for concise test setup. */
export async function mustPublish(ledger: Ledger, input: PublishInput, at: string, makeId?: () => string) {
	const r = await publish(ledger, input, at, makeId);
	if (!r.ok) throw new Error(r.errors.join("; "));
	return r;
}
