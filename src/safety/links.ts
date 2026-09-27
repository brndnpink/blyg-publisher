// Links, embeds, images, and query blocks: security rules 2–5.
// Everything here is decided against the vault through a resolver the
// caller supplies, so this module stays pure and testable.

import { classifyLines } from "./clean";
import { isInMediaDir, isInPublishRoot } from "./root";

export interface Problem {
	rule: number;
	message: string;
	/** 1-based line within the cleaned body. */
	line?: number;
}

export interface VaultView {
	/** Resolve an Obsidian link path from a source note to a vault path, or null if nothing matches. */
	resolve(linkpath: string, sourcePath: string): string | null;
	/** If the vault path is a published item, its id, kind, and public URL. */
	published(path: string): { id: string; kind: "fragment" | "thread"; url: string } | null;
	/** Notes inside 7 - Blyg whose name matches the link, for explaining ambiguous links. */
	sameNameInRoot?(linkpath: string): string[];
}

/** Hint for a link that resolved outside 7 - Blyg when a Blyg note has the same name. */
function ambiguityHint(vault: VaultView, path: string, embed: boolean): string {
	const twins = vault.sameNameInRoot?.(path) ?? [];
	if (!twins.length) return "";
	const full = twins[0].replace(/\.md$/, "");
	return ` A note in 7 - Blyg has the same name, but this link finds the private one. Link it by its full path instead: ${embed ? "!" : ""}[[${full}]]`;
}

export interface LinkResult {
	markdown: string;
	problems: Problem[];
}

const QUERY_LANGS = new Set(["dataview", "dataviewjs", "query", "tasks", "base", "bases", "js-engine", "meta-bind"]);

// ![[target#sub|alias]] and [[target#sub|alias]]
const WIKI = /(!?)\[\[([^\]\n]+?)\]\]/g;
// [text](dest) and ![alt](dest), dest without spaces or <...>
const MDLINK = /(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp|tiff?)$/i;
const SAFE_SCHEME = /^(https?:|mailto:)/i;

function parseWiki(inner: string) {
	const [target, alias] = inner.split("|", 2);
	const hash = target.indexOf("#");
	return {
		path: (hash === -1 ? target : target.slice(0, hash)).trim(),
		sub: hash === -1 ? "" : target.slice(hash + 1).trim(),
		alias: alias?.trim(),
	};
}

/** Split a line into alternating prose / inline-code segments so code spans stay literal. */
function segments(line: string): { text: string; code: boolean }[] {
	const out: { text: string; code: boolean }[] = [];
	const re = /(`+)[\s\S]*?\1/g;
	let last = 0;
	for (let m = re.exec(line); m; m = re.exec(line)) {
		if (m.index > last) out.push({ text: line.slice(last, m.index), code: false });
		out.push({ text: m[0], code: true });
		last = m.index + m[0].length;
	}
	if (last < line.length) out.push({ text: line.slice(last), code: false });
	return out;
}

/**
 * Check and rewrite links in cleaned Markdown.
 * - Threads: an own-line embed of a published fragment becomes the protocol
 *   directive `![[id]]`. Every other embed is refused (rule 2).
 * - Wikilinks to published items become ordinary links to their pages; links
 *   to anything else are refused, since even the link text can leak a note
 *   title (rule 3).
 * - Images must come from the media folder (rule 4). Image publishing itself
 *   isn't built yet, so for now every image is refused with a clear reason.
 * - Query code blocks are refused (rule 5).
 * - Markdown links may only point to http(s) or mailto.
 */
export function processLinks(markdown: string, kind: "fragment" | "thread", sourcePath: string, vault: VaultView): LinkResult {
	const problems: Problem[] = [];
	const out: string[] = [];

	classifyLines(markdown).forEach((line, i) => {
		const n = i + 1;
		if (line.code) {
			if (line.info && QUERY_LANGS.has(line.info)) {
				problems.push({ rule: 5, line: n, message: `"${line.info}" query blocks pull in other notes and can't be published` });
			}
			out.push(line.text);
			return;
		}

		// Own-line embed in a thread: the only embed that can be published.
		const own = /^\s*!\[\[([^\]\n]+)\]\]\s*$/.exec(line.text);
		if (own) {
			const { path, sub, alias } = parseWiki(own[1]);
			const target = vault.resolve(path, sourcePath);
			const label = `![[${own[1]}]]`;
			if (target && IMAGE_EXT.test(target)) {
				problems.push(imageProblem(target, n));
			} else if (kind === "fragment") {
				problems.push({ rule: 2, line: n, message: `${label}: fragments can't embed other notes; make this a thread` });
			} else if (!target) {
				problems.push({ rule: 2, line: n, message: `${label}: no note by that name` });
			} else if (!isInPublishRoot(target)) {
				problems.push({ rule: 2, line: n, message: `${label}: embeds a private note from outside 7 - Blyg.${ambiguityHint(vault, path, true)}` });
			} else if (sub || alias) {
				problems.push({ rule: 2, line: n, message: `${label}: embed the whole fragment (no #heading, ^block, or |alias)` });
			} else {
				const pub = vault.published(target);
				if (!pub) problems.push({ rule: 2, line: n, message: `${label}: that fragment hasn't been published yet` });
				else if (pub.kind !== "fragment") problems.push({ rule: 2, line: n, message: `${label}: only fragments can be embedded` });
				else {
					out.push(`![[${pub.id}]]`);
					return;
				}
			}
			out.push(line.text);
			return;
		}

		// Reference-style link definitions: "[ref]: destination". Same rule as inline links.
		const def = /^ {0,3}\[[^\]\n]+\]:\s*<?(\S+?)>?(?:\s.*)?$/.exec(line.text);
		if (def && !SAFE_SCHEME.test(def[1]) && !def[1].startsWith("#")) {
			problems.push({ rule: 3, line: n, message: `${line.text.trim()}: only web (https) and email links can be published` });
			out.push(line.text);
			return;
		}

		// Vault and local-file addresses anywhere in prose reveal vault names and paths.
		for (const seg of segments(line.text)) {
			const m = !seg.code && /\b(obsidian|file):\/\/\S*/i.exec(seg.text.replace(new RegExp(MDLINK.source, "g"), ""));
			if (m) problems.push({ rule: 3, line: n, message: `${m[0]}: vault and file addresses can't be published` });
		}

		const rewritten = segments(line.text)
			.map((seg) => {
				if (seg.code) return seg.text;
				let text = seg.text.replace(WIKI, (whole, bang: string, inner: string) => {
					const { path, alias } = parseWiki(inner);
					const target = vault.resolve(path, sourcePath);
					if (bang) {
						if (target && IMAGE_EXT.test(target)) problems.push(imageProblem(target, n));
						else problems.push({ rule: 2, line: n, message: `${whole}: embeds must be on a line of their own, in a thread` });
						return whole;
					}
					if (!target) {
						problems.push({ rule: 3, line: n, message: `${whole}: links to a note that doesn't exist` });
						return whole;
					}
					if (!isInPublishRoot(target)) {
						problems.push({ rule: 3, line: n, message: `${whole}: links to a private note outside 7 - Blyg.${ambiguityHint(vault, path, false)}` });
						return whole;
					}
					const pub = vault.published(target);
					if (!pub) {
						problems.push({ rule: 3, line: n, message: `${whole}: links to a Blyg note that hasn't been published` });
						return whole;
					}
					const label = alias || path.split("/").pop() || path;
					return `[${label}](${pub.url})`;
				});
				text = text.replace(MDLINK, (whole, bang: string, _label: string, dest: string) => {
					if (SAFE_SCHEME.test(dest) || dest.startsWith("#")) return whole;
					if (bang) {
						const target = vault.resolve(decodeURI(dest), sourcePath);
						problems.push(target ? imageProblem(target, n) : { rule: 4, line: n, message: `${whole}: image not found; images can only come from 7 - Blyg/media` });
					} else {
						problems.push({ rule: 3, line: n, message: `${whole}: only web (https) and email links can be published` });
					}
					return whole;
				});
				return text;
			})
			.join("");
		out.push(rewritten);
	});

	return { markdown: out.join("\n"), problems };
}

function imageProblem(target: string, line: number): Problem {
	return isInMediaDir(target)
		? { rule: 4, line, message: `${target}: image publishing isn't built yet` }
		: { rule: 4, line, message: `${target}: images can only come from 7 - Blyg/media` };
}
