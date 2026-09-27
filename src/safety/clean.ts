// Turning an Obsidian note into the Markdown the public will see.
// Rules 7 (body only) and 8 (hidden comments), plus Obsidian-only syntax
// that would otherwise leak into the published text.

export interface Split {
	frontmatter: string | null;
	body: string;
	/** 1-based line number in the original file where the body starts. */
	bodyStartLine: number;
}

/** Separate a leading YAML frontmatter block from the body. */
export function splitFrontmatter(text: string): Split {
	const src = text.replace(/\r\n?/g, "\n");
	if (!src.startsWith("---\n")) return { frontmatter: null, body: src, bodyStartLine: 1 };
	const lines = src.split("\n");
	for (let i = 1; i < lines.length; i++) {
		if (lines[i] === "---" || lines[i] === "...") {
			return {
				frontmatter: lines.slice(1, i).join("\n"),
				body: lines.slice(i + 1).join("\n"),
				bodyStartLine: i + 2,
			};
		}
	}
	// Unclosed: Obsidian doesn't treat it as frontmatter either.
	return { frontmatter: null, body: src, bodyStartLine: 1 };
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export interface Line {
	text: string;
	/** Inside a fenced code block (including the fence lines themselves). */
	code: boolean;
	/** The fence's info string, on an opening fence line. */
	info?: string;
}

/** Tag each line as prose or fenced code. */
export function classifyLines(body: string): Line[] {
	const out: Line[] = [];
	let fence: string | null = null;
	for (const text of body.split("\n")) {
		const f = FENCE.exec(text);
		if (fence) {
			out.push({ text, code: true });
			if (f && f[1][0] === fence[0] && f[1].length >= fence.length && f[2].trim() === "") fence = null;
		} else if (f) {
			fence = f[1];
			out.push({ text, code: true, info: f[2].trim().split(/\s+/)[0]?.toLowerCase() ?? "" });
		} else {
			out.push({ text, code: false });
		}
	}
	return out;
}

export interface CleanResult {
	markdown: string;
	/** True if a %% or <!-- comment was opened and never closed (everything after it was dropped). */
	unclosedComment: boolean;
	removedComments: number;
}

/**
 * Remove Obsidian comments (%% … %%) and HTML comments (<!-- … -->), which
 * are hidden in Obsidian but would be visible in the published content_md.
 * Comments may span lines. Fenced code is left alone: Obsidian shows it
 * literally, so nothing in it is hidden from the author. An unclosed comment
 * hides the rest of the note in Obsidian, so the rest is dropped here too.
 * Also strips trailing block ids (" ^abc123"), which Obsidian hides.
 */
export function stripHidden(body: string): CleanResult {
	const lines = classifyLines(body);
	const out: string[] = [];
	let open: "%%" | "<!--" | null = null;
	let removed = 0;

	for (const line of lines) {
		if (line.code && !open) {
			out.push(line.text);
			continue;
		}
		let rest = line.text;
		let kept = "";
		while (rest.length) {
			if (open) {
				const close = open === "%%" ? "%%" : "-->";
				const end = rest.indexOf(close);
				if (end === -1) {
					rest = "";
					break;
				}
				rest = rest.slice(end + close.length);
				open = null;
				continue;
			}
			const pct = rest.indexOf("%%");
			const html = rest.indexOf("<!--");
			const next = pct === -1 ? html : html === -1 ? pct : Math.min(pct, html);
			if (next === -1) {
				kept += rest;
				rest = "";
				break;
			}
			kept += rest.slice(0, next);
			open = next === pct ? "%%" : "<!--";
			rest = rest.slice(next + open.length);
			removed++;
		}
		out.push(kept.replace(/\s+\^[A-Za-z0-9-]+\s*$/, ""));
	}

	const markdown = out
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/^\n+/, "")
		.trimEnd();
	return { markdown, unclosedComment: open !== null, removedComments: removed };
}
