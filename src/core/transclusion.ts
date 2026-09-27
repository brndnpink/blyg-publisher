// Transclusion grammar and publish-time resolution — spec 0.2 §10.
// At 0.2 every directive must resolve to a local, currently published fragment.

import { renderMarkdown } from "./markdown";
import type { Ledger, Transclusion } from "./types";
import { ID_ALPHABET } from "./util";

const DIRECTIVE_LINE = new RegExp(`^\\s*!\\[\\[([${ID_ALPHABET}]{26})\\]\\]\\s*$`);
const RESERVED_LINE = new RegExp(`^\\s*!\\[\\[([${ID_ALPHABET}]{26})@v\\d+\\]\\]\\s*$`);
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export interface ResolvedThread {
	html: string;
	transclusions: Transclusion[];
	errors: string[];
}

/**
 * Walks the markdown line by line. Own-line directives outside code fences are
 * resolved; everything else is prose. Prose runs between directives render
 * separately and parts join with "\n", matching the reference client's output.
 *
 * Unlike the reference, directive-shaped lines inside fenced code blocks stay
 * inert text, as §10.1 requires.
 */
export function resolveThread(contentMd: string, ledger: Ledger): ResolvedThread {
	const errors: string[] = [];
	const transclusions: Transclusion[] = [];
	const parts: string[] = [];
	let prose: string[] = [];
	let fence: string | null = null;

	const flush = () => {
		if (prose.length) {
			parts.push(renderMarkdown(prose.join("\n")));
			prose = [];
		}
	};

	for (const line of contentMd.split("\n")) {
		const f = FENCE.exec(line);
		if (fence) {
			if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
			prose.push(line);
			continue;
		}
		if (f) {
			fence = f[1];
			prose.push(line);
			continue;
		}
		if (RESERVED_LINE.test(line)) {
			errors.push(`${line.trim()}: version-pinned embeds (@vN) are reserved and not allowed yet`);
			continue;
		}
		const m = DIRECTIVE_LINE.exec(line);
		if (!m) {
			prose.push(line);
			continue;
		}
		flush();
		const id = m[1];
		const target = ledger.items[id];
		const latest = target?.versions.at(-1);
		if (!target || !latest) {
			errors.push(`${line.trim()}: no published item with that id`);
			continue;
		}
		if (latest.kind === "withdrawn") {
			errors.push(`${line.trim()}: that item is withdrawn`);
			continue;
		}
		if (latest.kind !== "fragment") {
			errors.push(`${line.trim()}: only fragments can be embedded (that item is a thread)`);
			continue;
		}
		transclusions.push({ id, version: latest.version });
		parts.push(
			`<blockquote class="blyg-transclusion" data-blyg-id="${id}" data-blyg-version="${latest.version}">\n${latest.content_html}\n</blockquote>`,
		);
	}
	flush();
	return { html: parts.join("\n"), transclusions, errors };
}

/** True if any own-line directive (or reserved @vN form) appears outside code fences. */
export function hasDirectives(contentMd: string): boolean {
	let fence: string | null = null;
	for (const line of contentMd.split("\n")) {
		const f = FENCE.exec(line);
		if (fence) {
			if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
			continue;
		}
		if (f) {
			fence = f[1];
			continue;
		}
		if (DIRECTIVE_LINE.test(line) || RESERVED_LINE.test(line)) return true;
	}
	return false;
}
