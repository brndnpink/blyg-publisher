// Markdown rendering — configured exactly like the reference client so the
// same content_md produces the same content_html on both.

import MarkdownIt from "markdown-it";

// Raw HTML in markdown is escaped, never passed through.
const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

export function renderMarkdown(contentMd: string): string {
	return md.render(contentMd);
}

const BLOCK_END = /<\/(?:p|h[1-6]|li|blockquote|pre|div|tr|section|article)>|<br\s*\/?>/gi;

function decodeEntities(s: string): string {
	return s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&"); // last, so "&amp;lt;" stays the text "&lt;"
}

/** Plain text of rendered HTML; block ends become spaces so paragraphs don't weld together. */
export function plainTextFromHtml(html: string): string {
	return decodeEntities(html.replace(BLOCK_END, " ").replace(/<[^>]+>/g, ""))
		.replace(/\s+/g, " ")
		.trim();
}

/** First ~n characters of plain text, ellipsized — for feed titles. */
export function excerptFromHtml(html: string, n = 60): string {
	const text = plainTextFromHtml(html);
	return text.length <= n ? text : text.slice(0, n).trimEnd() + "…";
}
