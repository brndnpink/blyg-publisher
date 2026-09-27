// The public site's stylesheet: an original theme in the Bear Blog spirit
// (system font, one narrow column, no JavaScript, automatic dark mode).

export const THEME_CSS = `:root {
  --width: 720px;
  --font: Verdana, Geneva, sans-serif;
  --bg: #fff; --heading: #222; --text: #444; --muted: #777;
  --link: #3273dc; --visited: #8b6fcb; --rule: #ccc;
  --code-bg: #f2f2f2; --quote: #555;
  --tc-bg: #f6f6f3; --tc-edge: #3273dc;
  --gen-bg: #fff3d6; --gen-edge: #d9a93c;
  --pin: #a15c00; --frozen-bg: #f4f1ea;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #01242e; --heading: #eee; --text: #ddd; --muted: #9ab;
    --link: #8cc2dd; --visited: #b9a3e8; --rule: #2e5361;
    --code-bg: #000; --quote: #ccc;
    --tc-bg: #0a3340; --tc-edge: #8cc2dd;
    --gen-bg: #3a3218; --gen-edge: #c9a24a;
    --pin: #f0b35c; --frozen-bg: #0c3441;
  }
}
body {
  font-family: var(--font); font-size: 15px; line-height: 1.55;
  margin: auto; padding: 20px; max-width: var(--width);
  background: var(--bg); color: var(--text); overflow-wrap: break-word;
}
h1, h2, h3, h4, h5, h6 { color: var(--heading); font-family: var(--font); }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
strong, b { color: var(--heading); }
hr { border: 0; border-top: 1px dashed var(--rule); margin: 28px 0; }
img { max-width: 100%; }
code { font-family: monospace; padding: 2px; background: var(--code-bg); border-radius: 3px; }
pre { background: var(--code-bg); padding: 10px 14px; border-radius: 3px; overflow-x: auto; }
pre code { padding: 0; }
table { width: 100%; }

header { margin-bottom: 8px; }
.title { color: var(--heading); }
.title h1 { font-size: 1.5em; margin: 0 0 4px; }
nav a { margin-right: 10px; }
.tagline { color: var(--muted); font-size: .92em; margin: 14px 0 0; }

ul.entries { list-style: none; padding: 0; margin: 20px 0; }
ul.entries li { display: flex; gap: 14px; margin: 0 0 12px; }
ul.entries .date { flex: 0 0 104px; color: var(--muted); font-size: .9em; padding-top: 1px; font-variant-numeric: tabular-nums; }
ul.entries .body { flex: 1; min-width: 0; }
ul.entries a:visited { color: var(--visited); }
.meta { color: var(--muted); font-size: .8em; margin-left: 6px; white-space: nowrap; }
.kind { font-size: .72em; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); margin-right: 6px; }
.pin { color: var(--pin); font-size: .8em; white-space: nowrap; }
.empty { color: var(--muted); }

article h1 { font-size: 1.45em; margin: 18px 0 4px; }
.byline { color: var(--muted); font-size: .85em; margin: 6px 0 22px; }
article p { line-height: 1.65; }
article.fragment .content { font-size: 1.08em; margin-top: 18px; }

blockquote { margin: 18px 0; padding-left: 18px; border-left: 1px solid var(--rule); color: var(--quote); font-style: italic; }
/* Blygger CSS contract: transclusions must read as quoted material. */
blockquote.blyg-transclusion {
  font-style: normal; color: var(--text); background: var(--tc-bg);
  border-left: 3px solid var(--tc-edge); padding: 10px 14px 8px; border-radius: 0 4px 4px 0;
}
blockquote.blyg-transclusion p { margin: 0 0 6px; line-height: 1.6; }
.tc-source { display: block; font-size: .78em; color: var(--muted); font-style: normal; }
/* Blygger CSS contract: generated text must never be hidden. */
.blyg-tk-gen { background: var(--gen-bg); border-bottom: 1px dotted var(--gen-edge); padding: 0 2px; }
.gen-key { font-size: .8em; color: var(--muted); }

.frozen { background: var(--frozen-bg); border-left: 3px solid var(--pin); padding: 10px 14px; font-size: .88em; margin: 18px 0; }
.withdrawn { color: var(--muted); font-style: italic; }

.changelog h2 { font-size: 1em; margin: 0 0 8px; }
.changelog ol { list-style: none; padding: 0; margin: 0; font-size: .88em; }
.changelog li { display: flex; gap: 14px; margin: 0 0 4px; }
.changelog .v { flex: 0 0 40px; color: var(--heading); }
.changelog .when { flex: 0 0 104px; color: var(--muted); }

footer { text-align: center; color: var(--muted); font-size: .82em; padding: 26px 0 6px; }
footer a { margin: 0 5px; }

@media (max-width: 520px) {
  ul.entries li { flex-direction: column; gap: 0; }
  ul.entries .date { flex: none; font-size: .8em; }
  .changelog .when { flex-basis: 84px; }
}
`;
