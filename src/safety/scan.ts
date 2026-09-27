// The sensitive-content scan (rule 6). It flags; it never edits. Each flag
// has to be confirmed by the author before publishing.

export interface Flag {
	term: string;
	/** Why it was flagged: "denylist" or the name of a built-in pattern. */
	source: string;
	line: number;
	excerpt: string;
}

export interface Denylist {
	terms: string[];
}

/**
 * Parse the denylist file: one term per line; blank lines and lines starting
 * with # are ignored. Matching is case-insensitive, on word boundaries, and
 * treats any run of whitespace in a term as flexible.
 */
export function parseDenylist(text: string): Denylist {
	const terms = text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("#"));
	return { terms: [...new Set(terms)] };
}

const BUILT_IN: { source: string; re: RegExp }[] = [
	{ source: "email address", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
	{ source: "phone number", re: /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g },
	{ source: "IEP", re: /\bIEPs?\b/g },
	{ source: "504 plan", re: /\b504\b/g },
];

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termPattern(term: string): RegExp {
	const body = term.split(/\s+/).map(escapeRe).join("\\s+");
	return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
}

function excerptAround(text: string, index: number, length: number): string {
	const start = Math.max(0, index - 30);
	const end = Math.min(text.length, index + length + 30);
	return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ") + (end < text.length ? "…" : "");
}

/** Scan the public Markdown. Returns one flag per match. */
export function scan(markdown: string, denylist: Denylist): Flag[] {
	const flags: Flag[] = [];
	const lineOf = (i: number) => markdown.slice(0, i).split("\n").length;
	const patterns = [
		...denylist.terms.map((t) => ({ source: "denylist", re: termPattern(t) })),
		...BUILT_IN,
	];
	for (const { source, re } of patterns) {
		re.lastIndex = 0;
		for (let m = re.exec(markdown); m; m = re.exec(markdown)) {
			flags.push({ term: m[0], source, line: lineOf(m.index), excerpt: excerptAround(markdown, m.index, m[0].length) });
			if (m[0].length === 0) re.lastIndex++;
		}
	}
	return flags.sort((a, b) => a.line - b.line);
}
