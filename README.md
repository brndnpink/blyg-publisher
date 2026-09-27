# Blyg Publisher

An Obsidian plugin for writing a **[Blygger](https://blygger.org)** blyg from your vault.

Blygger is a protocol for writing in public: short **fragments**, long **threads** built out of fragments, and a feed that works like a changelog, so editing in public is normal instead of embarrassing. A blyg is just a folder of static files and an RSS feed on your own domain. See [blygger.org](https://blygger.org) for the idea and the spec.

Blyg Publisher turns **one folder of your vault** into a blyg and deploys it to a free static host. It is local-first: your notes and your publishing history stay on your computer, and there is no server of its own.

> **Using an AI agent?** Point it at this repository and say:
> *"Set up Blyg Publisher from https://github.com/brndnpink/blyg-publisher in my Obsidian vault. Follow AGENTS.md."*
> The agent handles the install and configuration and tells you the few steps only you can do (clicking in Obsidian, approving a Cloudflare login). [AGENTS.md](AGENTS.md) is written for it; this README is written for you.

---

## What you get

- A **Blyg panel** in Obsidian's right sidebar that follows the note you're editing: whether it can be published, safety checks, its versions, and buttons to publish, pin, withdraw, and deploy.
- A **publish window** that shows exactly what the public will see and what changed since the last version, before anything is saved.
- A clean, fast public site in the style of [Bear Blog](https://bearblog.dev): no JavaScript, no trackers, automatic dark mode. It sits next to the protocol files other blyg apps read.
- Everything Blygger 0.2 asks of a publisher at Level 1: stable ids, versions, a changelog feed, an archive index, pins, withdrawal, and threads that quote fragments with provenance. It has been tested against the reference client's import code.

## Requirements

- **Obsidian desktop** 1.7.2 or newer. The plugin doesn't run on mobile.
- **macOS.** Deploying runs Cloudflare's command-line tool through the system shell. Linux probably works; Windows isn't supported yet.
- **Node.js** (for `npx`), used only when deploying.
- A free **Cloudflare** account for hosting. A domain of your own is optional: you can start on a free `*.pages.dev` address.

## Install

**With an agent:** see the box above.

**By hand:** run the installer with your vault's path:

```bash
curl -fsSL https://raw.githubusercontent.com/brndnpink/blyg-publisher/main/scripts/install.sh | bash -s -- "/path/to/your/vault"
```

Or download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/brndnpink/blyg-publisher/releases/latest) into `<your vault>/.obsidian/plugins/blyg-publisher/`.

Then in Obsidian: **Settings → Community plugins**, turn community plugins on if they're off, and enable **Blyg Publisher**.

## Set up

1. **Make the publish folder.** Create a top-level folder named `Blyg`, or choose another name in the plugin's settings. **Only notes in this folder can ever be published.** Everything else in your vault stays private. Inside it, `fragments/` and `threads/` subfolders are a good habit but optional.
2. **Fill in settings** (Settings → Blyg Publisher):
   - **Web address:** where the blyg will live, ending in `/`. For example `https://yourdomain.com/blyg/`, or `https://your-project.pages.dev/blyg/` if you don't have a domain.
   - **Title** and **Author name.** A pen name works fine; nothing else about you is published.
   - **Cloudflare Pages project:** a short name like `my-blyg`.
3. **Connect Cloudflare** (once), in Terminal:
   ```bash
   npx wrangler@4 login
   ```
   ```bash
   npx wrangler@4 pages project create my-blyg --production-branch main
   ```
   The first command opens your browser to approve the login. Use your project name in the second.
4. **Optional, your own domain:** in the Cloudflare dashboard, go to **Workers & Pages → your project → Custom domains** and add it. Use the same address in the *Web address* setting.

## The workflow

**Write.** Work in Obsidian as usual. When a note is ready to go public, it needs to be in the publish folder:
- **Promote a copy** (in the panel, when a private note is open) copies it into the publish folder for you to edit. The original stays private and untouched, and its tags and properties are left behind.
- Or create the note directly in the publish folder.

**Mark it.** Click **Make fragment** or **Make thread** in the panel. This adds `blyg: publish` and the kind to the note's properties. Nothing is public until you mark a note *and* publish it.

- A **fragment** is one short idea (2,000 characters at most; 1,000 or fewer recommended).
- A **thread** is longer writing. It can **embed fragments**: in the panel's *Embed a fragment* list, click **insert** to put `![[Note name]]` on its own line. When published, the fragment's text is quoted into the thread with a link back to it.

**Publish.** Click **Preview & publish**. The window shows the public text and the changes since the last version, plus the check results. You can add an optional change note for the changelog. Publishing records a new **version** in your private ledger. It isn't online yet.

**Deploy.** Click **Deploy** in the panel's *Site* card. Before uploading, it compares against what's already live and refuses anything that would roll the site backward. Deploys are cheap; publish several things and deploy once.

**Keep going.** Edit and publish again whenever you like. Readers see the latest version and a changelog of dates and notes, never diffs. Click any version in the panel to see it privately, with what changed from the version before.

**Pin** a version to make a permanent, citable copy at its own address. A pin can't be undone.

**Withdraw** an item to take it down. Its address stays up but shows that it was withdrawn, and pinned versions stay public. You can bring it back by publishing again. There is no delete, because copies already fetched by feed readers can't be recalled.

### Titles

A note's name becomes its public title. To use a different one, add a `blyg_title` property. Threads show the title as a heading at the top, unless the note already starts with a heading. Fragments show it on their page and in the feed, but not inside the quote when they're embedded in a thread.

### Properties the plugin uses

| Property | Set by | Meaning |
|---|---|---|
| `blyg: publish` | you (Make fragment/thread) | Opt-in. Without it the note is never published. |
| `blyg_kind` | you | `fragment` or `thread`. Can't change after the first publish. |
| `blyg_id` | the plugin | Permanent id, written on first publish. Don't edit it or copy it to another note. |
| `blyg_title` | you, optional | Public title if it should differ from the note's name. |

## Safety

The plugin is built so that publishing is always deliberate and only what you meant goes out.

- **One folder.** Nothing outside the publish folder is ever read for publishing.
- **Opt-in per note, and explicit steps.** A note needs `blyg: publish` and a kind, and nothing publishes when you save: publishing takes a click and a confirmation, and deploying takes another.
- **Only the note's text goes out.** Properties, tags, and aliases never leave the vault. **Hidden comments** (`%% … %%` and `<!-- … -->`) are removed, because the protocol publishes the raw Markdown.
- **Refused until fixed:**
  - links or embeds pointing outside the publish folder, since even a link's text can reveal a private note's title
  - `obsidian://` and `file://` addresses
  - images, which aren't supported yet
  - Dataview and other query blocks
- **Optional name scan.** Turn it on in settings to flag email addresses, phone numbers, "IEP", "504", and any names in a private list you keep outside the publish folder. It flags matches and never edits your text; you confirm each match or fix it. It runs again before every deploy, so names you add to the list later are caught in older items too.
- **No rollback.** The plugin refuses to deploy anything that would move a live item to an older version, change a published version's text, or drop a pin. If you sync your vault between computers, it also stops when it sees a sync-conflict copy of the ledger.
- **Your history stays yours.** The full history of every item is kept in `<publish folder>/.blyg/ledger.json`, with automatic backups. Only the current version and pinned versions are ever public.

## Status and limits

- Version 0.1, early. Implements the Blygger 0.2 spec at Level 1 on the publishing side. The spec is pre-1.0 and may change.
- **Not yet:** images, AI-generated connective text ("TK"), blogrolls, reading other blygs inside Obsidian (use any RSS reader for now), and Windows.
- Only one computer should deploy at a time. The ledger syncs with your vault, and the plugin checks for conflicts, but it can't coordinate two deploys running at once.

## Building from source

```bash
git clone https://github.com/brndnpink/blyg-publisher.git
cd blyg-publisher
npm install
npm test
BLYG_VAULT="/path/to/vault" npm run install-plugin   # type-check, test, build, copy into the vault
```

The code is split so the protocol and safety rules can be tested without Obsidian:
- `src/core/`: ids, the ledger, protocol files
- `src/safety/`: what may be published
- `src/site/`: public pages
- `src/deploy/`: the only code that uses the network

The tests enforce that last split.

## Credits

Blygger was designed by Venkatesh Rao and collaborators; see [blygger.org](https://blygger.org) and [github.com/blygger](https://github.com/blygger). This plugin is an independent implementation.

## License

[MIT](LICENSE)
