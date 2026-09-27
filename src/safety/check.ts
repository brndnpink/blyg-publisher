// One entry point for the sidebar and the publish flow: take a note exactly
// as it sits in the vault and return either the public Markdown or the
// reasons it can't be published. Pure; the plugin supplies vault access.

import { isValidId } from "../core/util";
import { classifyLines, splitFrontmatter, stripHidden } from "./clean";
import { processLinks, type Problem, type VaultView } from "./links";
import { isPublishableNotePath } from "./root";
import { scan, type Denylist, type Flag } from "./scan";

export interface NoteInput {
	/** Vault-relative path, e.g. "7 - Blyg/fragments/Some note.md". */
	path: string;
	/** The note's name as Obsidian shows it (filename without .md). */
	basename?: string;
	/** The whole file, frontmatter included. */
	text: string;
	/** Parsed frontmatter (Obsidian's metadata cache supplies it). */
	frontmatter: Record<string, unknown> | undefined;
}

export interface CheckResult {
	/** Set only when the note is opted in and in the right place; null otherwise. */
	kind: "fragment" | "thread" | null;
	id: string | null;
	/** What would be published: cleaned, links rewritten (threads start with their title heading). */
	publicMarkdown: string;
	/** Public title: blyg_title if set, else the note's name; for threads, their own leading heading if they have one. */
	title: string;
	/** Anything here blocks publishing. */
	problems: Problem[];
	/** Must each be confirmed by the author before publishing (rule 6). */
	flags: Flag[];
	/** Don't block; worth knowing. */
	warnings: string[];
}

export function checkNote(note: NoteInput, vault: VaultView, denylist: Denylist): CheckResult {
	const problems: Problem[] = [];
	const warnings: string[] = [];
	const fm = note.frontmatter ?? {};

	// Rule 1: location and opt-in.
	if (!isPublishableNotePath(note.path)) {
		problems.push({ rule: 1, message: "This note is outside 7 - Blyg. Only notes in that folder can be published." });
		return { kind: null, id: null, publicMarkdown: "", title: "", problems, flags: [], warnings };
	}
	if (fm.blyg !== "publish") {
		problems.push({ rule: 1, message: 'Not marked for publishing (needs "blyg: publish" in its properties).' });
	}
	const kind = fm.blyg_kind === "fragment" || fm.blyg_kind === "thread" ? fm.blyg_kind : null;
	if (!kind) problems.push({ rule: 1, message: 'Needs "blyg_kind: fragment" or "blyg_kind: thread".' });
	const rawId = fm.blyg_id;
	const id = typeof rawId === "string" && rawId !== "" ? rawId : null;
	if (rawId !== undefined && rawId !== null && rawId !== "" && (typeof rawId !== "string" || !isValidId(rawId))) {
		problems.push({ rule: 1, message: "blyg_id has been edited and is no longer valid. Restore it from the ledger." });
	}
	if (problems.length) return { kind: null, id, publicMarkdown: "", title: "", problems, flags: [], warnings };

	// Rules 7 and 8: body only, hidden comments removed.
	const { body } = splitFrontmatter(note.text);
	const cleaned = stripHidden(body);
	if (cleaned.unclosedComment) {
		warnings.push("A %% or <!-- comment is never closed, so everything after it was left out.");
	}

	// Rules 2–5.
	const links = processLinks(cleaned.markdown, kind!, note.path, vault);
	problems.push(...links.problems);

	// The title is public text too.
	const fallback = note.basename ?? note.path.split("/").pop()!.replace(/\.md$/, "");
	let title = (typeof fm.blyg_title === "string" && fm.blyg_title.trim() ? fm.blyg_title : fallback).replace(/\s+/g, " ").trim();
	let markdown = links.markdown;
	if (kind === "thread" && markdown.trim() !== "") {
		const firstLine = markdown.split("\n").find((l) => l.trim() !== "") ?? "";
		const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(firstLine);
		if (heading) title = heading[1].trim();
		else markdown = `# ${title.replace(/^#+\s*/, "")}\n\n${markdown}`;
	}
	if (/\[\[|\]\]|obsidian:\/\//i.test(title)) {
		problems.push({ rule: 3, message: `The title "${title}" contains link syntax. Set a plain blyg_title property.` });
	}
	if (title.length > 200) problems.push({ rule: 7, message: "The title is over 200 characters. Set a shorter blyg_title property." });

	// Rule 6: scan the title and the text.
	const flags = [...scan(title, denylist).map((f) => ({ ...f, line: 0, excerpt: `Title: ${f.excerpt}` })), ...scan(markdown, denylist)];

	if (links.markdown.trim() === "") problems.push({ rule: 7, message: "Nothing to publish: the note is empty after cleaning." });
	warnings.push(...syntaxWarnings(markdown));

	return { kind, id, publicMarkdown: markdown, title, problems, flags, warnings };
}

/** Obsidian conveniences that render differently on the public site. */
function syntaxWarnings(markdown: string): string[] {
	const w: string[] = [];
	const prose = classifyLines(markdown).filter((l) => !l.code).map((l) => l.text);
	if (prose.some((l) => /^\s*>\s*\[![\w-]+\]/.test(l))) w.push("Callouts will appear as plain quotes, with the [!type] marker showing.");
	if (prose.some((l) => /==[^=\n]+==/.test(l))) w.push("==Highlights== will appear with the equals signs showing.");
	const softBreak = prose.some((l, i) => {
		const next = prose[i + 1];
		const isBlock = (s: string) => /^\s*([-*+]|\d+[.)]|#{1,6}\s|>|\|)/.test(s);
		return l.trim() !== "" && next !== undefined && next.trim() !== "" && !isBlock(l) && !isBlock(next);
	});
	if (softBreak) {
		w.push("Single line breaks inside a paragraph will be joined into one line on the site. Leave a blank line to start a new paragraph.");
	}
	return w;
}
