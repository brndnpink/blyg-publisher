# Blyg Publisher

An Obsidian plugin for writing to your **[Blygger](https://blygger.org)** blyg from your vault.

Blygger is a protocol for writing in public: short **fragments**, long **threads** built out of fragments, and a feed that works like a changelog, so editing in public is normal instead of embarrassing. See [blygger.org](https://blygger.org) for the idea and the spec.

Blyg Publisher lets you **write in Obsidian and publish to your blyg**. Only notes in one dedicated folder can ever be published, and each publish goes through a preview.

- **Already have a blyg?** It connects to your existing blyg (the Blygger reference server that most blygs run today) and publishes straight to it. Nothing else to set up.
- **No blyg yet?** It can instead build and host a small static blyg for you on Cloudflare Pages. See [No blyg yet?](#no-blyg-yet-publish-a-static-one) below.

> **Using an AI agent?** Point it at this repository and say:
> *"Set up Blyg Publisher from https://github.com/brndnpink/blyg-publisher in my Obsidian vault. Follow AGENTS.md."*
> The agent handles the install and settings and tells you the few steps only you can do, such as enabling the plugin and logging in. [AGENTS.md](AGENTS.md) is written for it; this README is written for you.

---

## What you get

- A **Blyg panel** in Obsidian's right sidebar that follows the note you're editing: whether it can be published, safety checks, its versions, and buttons to publish, pin, and withdraw.
- A **publish window** that shows exactly what readers will see and what changed since the live version, before anything goes out.
- An **embed picker** for threads: pick one of your published fragments and it's quoted into the thread, with provenance, when you publish.
- **Safety by design:**
  - one publish folder
  - opt-in per note
  - hidden comments and properties stripped
  - links to private notes refused
  - an optional name scan

## Requirements

- **Obsidian desktop** 1.7.2 or newer. The plugin doesn't run on mobile.
- **macOS** (tested). Linux probably works; Windows is untested.
- **To connect to an existing blyg:** its address and its studio password.
- **Only for the static option:** Node.js (for `npx`) and a free Cloudflare account.

## Install

**With an agent:** see the box above.

**By hand:** run the installer with your vault's path:

```bash
curl -fsSL https://raw.githubusercontent.com/brndnpink/blyg-publisher/main/scripts/install.sh | bash -s -- "/path/to/your/vault"
```

Or download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/brndnpink/blyg-publisher/releases/latest) into `<your vault>/.obsidian/plugins/blyg-publisher/`.

Then in Obsidian: **Settings → Community plugins**, turn community plugins on if they're off, and enable **Blyg Publisher**.

## Connect it to your blyg

1. **Make the publish folder.** Create a top-level folder named `Blyg`, or choose another name in settings. **Only notes in this folder can ever be published.** Everything else in your vault stays private. `fragments/` and `threads/` subfolders are a good habit but optional.
2. **Settings → Blyg Publisher:**
   - **Publish to:** *My existing blyg* (the default).
   - **Blyg address:** your blyg's public address, the page that lists your fragments and threads. For example `https://example.com/blyg/`.
   - **Account → Log in…:** enter your blyg's studio password. It's used once to log in and isn't stored. Only the login session is kept, in Obsidian's secure storage, and it lasts about 30 days.

That's it. When you publish, it goes live on your blyg immediately. Your blyg's studio still works as before; items you publish from Obsidian appear there too.

## The workflow

**Write.** Work in Obsidian as usual. When a note is ready to go public, it needs to be in the publish folder:
- **Promote a copy** (in the panel, when a private note is open) copies it into the publish folder for you to edit. The original stays private and untouched, and its tags and properties are left behind.
- Or create the note directly in the publish folder.

**Mark it.** Click **Make fragment** or **Make thread** in the panel. This adds `blyg: publish` and the kind to the note's properties. Nothing is public until you mark a note *and* publish it.

- A **fragment** is one short idea (2,000 characters at most; 1,000 or fewer recommended).
- A **thread** is longer writing. It can **embed fragments**: in the panel's *Embed a fragment* list, click **insert** to put `![[Note name]]` on its own line. When published, the fragment's text is quoted into the thread with a link back to it.

**Publish.** Click **Preview & publish**. The window shows the public text and the changes since the live version, plus the check results. You can add an optional change note for the changelog. Then click **Publish**; it goes live on your blyg.

**Keep going.** Edit and publish again whenever you like. Readers see the latest version and a changelog of dates and notes, never diffs. The panel lists every version; click one to see it.

**Pin** a version to make a permanent, citable copy at its own address. A pin can't be undone.

**Withdraw** an item to take it down. Its address stays up but shows that it was withdrawn, and pinned versions stay public. You can bring it back by publishing again. There is no delete, because copies already fetched by feed readers can't be recalled.

**Titles.** A thread's title is its first heading. If the note doesn't start with one, the note's name (or a `blyg_title` property) is added as a heading. Fragments are untitled on a standard blyg.

### Properties the plugin uses

| Property | Set by | Meaning |
|---|---|---|
| `blyg: publish` | you (Make fragment/thread) | Opt-in. Without it the note is never published. |
| `blyg_kind` | you | `fragment` or `thread`. Can't change after the first publish. |
| `blyg_id` | the plugin | The item's permanent id on your blyg, written on first publish. Don't edit it or copy it to another note. |
| `blyg_title` | you, optional | Title if it should differ from the note's name. |

## Safety

Publishing is always deliberate, and only what you meant goes out.

- **One folder.** Nothing outside the publish folder is ever read for publishing.
- **Opt-in per note, and explicit steps.** A note needs `blyg: publish` and a kind, and nothing publishes when you save: publishing takes a click and a confirmation.
- **Only the note's text goes out.** Properties, tags, and aliases never leave the vault. **Hidden comments** (`%% … %%` and `<!-- … -->`) are removed, because Blygger publishes the raw Markdown.
- **Refused until fixed:**
  - links or embeds pointing outside the publish folder, since even a link's text can reveal a private note's title
  - `obsidian://` and `file://` addresses
  - images, which aren't supported yet
  - Dataview and other query blocks
- **Optional name scan.** Turn it on in settings to flag email addresses, phone numbers, "IEP", "504", and any names in a private list you keep outside the publish folder. It flags matches and never edits your text; you confirm each match or fix it.
- **Your password isn't stored.** Only the login session is kept, in Obsidian's secure storage, not in your vault.

## No blyg yet? Publish a static one

If you don't run a blyg, the plugin can be one. Set **Publish to → A static site I deploy**. The plugin then:

- **keeps your blyg's history itself,** in `<publish folder>/.blyg/ledger.json`, with automatic backups
- **builds all the Blygger files plus a simple public site:** Bear Blog-style pages, no JavaScript, automatic dark mode
- **deploys to a free Cloudflare Pages site** when you click **Deploy** in the panel. Before uploading, it compares against what's already live and refuses anything that would roll the site backward.

Setup, once, in Terminal (the first command opens your browser to approve the login):

```bash
npx wrangler@4 login
```
```bash
npx wrangler@4 pages project create my-blyg --production-branch main
```

Then fill in the static-site settings: web address (for example `https://my-blyg.pages.dev/blyg/`, or your own domain), title, author name, and the Pages project name. Publish records versions locally; **Deploy** puts them online. Static mode also publishes fragment titles and offers a one-time **Start over** to clear test items before your first deploy.

## Status and limits

- Version 0.2, early. Implements Blygger 0.2 publishing at Level 1.
- **Existing-blyg mode** is built for the Blygger reference server (`blygger-spec`) and its owner API. It has been tested against a local copy of that server. The spec is pre-1.0; if the server's API changes, this mode may need an update.
- **Not yet:** images, AI-generated connective text ("TK"), and reading other blygs inside Obsidian (use your blyg's studio or any RSS reader).

## Building from source

```bash
git clone https://github.com/brndnpink/blyg-publisher.git
cd blyg-publisher
npm install
npm test
BLYG_VAULT="/path/to/vault" npm run install-plugin   # type-check, test, build, copy into the vault
```

The code is split so the protocol and safety rules can be tested without Obsidian:
- `src/core/`: ids, versions, protocol files
- `src/safety/`: what may be published
- `src/site/`: static-mode pages
- `src/deploy/`: every network call, including the reference-server client

`test/server.integration.test.ts` runs against a live reference server when you set `BLYG_TEST_SERVER` and `BLYG_TEST_PASSWORD`.

## Credits

Blygger was designed by Venkatesh Rao and collaborators; see [blygger.org](https://blygger.org) and [github.com/blygger](https://github.com/blygger). This plugin is an independent client.

## License

[MIT](LICENSE)
