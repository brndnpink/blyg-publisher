# AGENTS.md: setting up Blyg Publisher for a person

You are helping a person install and use **Blyg Publisher**, an Obsidian plugin that publishes to a [Blygger](https://blygger.org) blyg from one folder of their vault. This file is your runbook, from "here's the repo" to their first published item. The human-oriented overview is [README.md](README.md). Read its **Workflow** and **Safety** sections first.

There are two ways to publish; find out which the person needs (Step 4):

- **Existing blyg** (the default). They already run a blyg on the Blygger reference server, with a studio and a password. The plugin publishes straight to it. **Most people are in this group.**
- **Static site.** They have no blyg. The plugin keeps the history locally and deploys a static blyg to Cloudflare Pages.

## Ground rules

1. **Publishing is public and effectively permanent.** Never publish, pin, withdraw, deploy, or run *Start over* on the person's behalf. Those are their clicks, in Obsidian, after they've seen the preview. You may explain, prepare, check, and verify.
2. **Never ask for, type, or store their blyg password.** They enter it themselves in the plugin's **Log in** window. The same applies to Cloudflare: its login happens in their browser.
3. **Don't read, move, or quote their private notes** beyond what a step needs. Keep your own work to the publish folder, the plugin folder, and the settings file.
4. **Never hand-edit** `blyg_id` properties, or (static mode) `<publish folder>/.blyg/`.
5. **Ask before anything that creates accounts, spends money, or changes their Cloudflare account.**

## Human-only steps (say so clearly when you reach one)

- Turning on community plugins and enabling **Blyg Publisher** in Obsidian.
- **Log in…** to their blyg (existing-blyg mode), or approving `wrangler login` (static mode).
- Every **Publish**, **Pin**, **Withdraw**, **Deploy**, and **Start over** click.

## Step 0: Check prerequisites

```bash
sw_vers -productName    # macOS is tested; Linux probably works; Windows is untested
```

The plugin needs Obsidian **desktop** 1.7.2 or newer. Static mode additionally needs `node --version` (v18+) and `npx`.

## Step 1: Find the vault

Ask which vault to use. On macOS, Obsidian lists its vaults here:

```bash
python3 -c "import json,os;[print(v['path']) for v in json.load(open(os.path.expanduser('~/Library/Application Support/obsidian/obsidian.json')))['vaults'].values()]"
```

Confirm the path with them. A vault contains `.obsidian/`. Below, `$VAULT` is that path, quoted when used, since vault paths often contain spaces and apostrophes.

## Step 2: Install the plugin

```bash
curl -fsSL https://raw.githubusercontent.com/brndnpink/blyg-publisher/main/scripts/install.sh | bash -s -- "$VAULT"
```

This downloads the latest release's `main.js`, `manifest.json`, and `styles.css` into `"$VAULT/.obsidian/plugins/blyg-publisher/"`. It never touches `data.json` (settings) or any note. Re-running it updates the plugin.

Verify:

```bash
ls "$VAULT/.obsidian/plugins/blyg-publisher/"                        # main.js  manifest.json  styles.css
grep '"version"' "$VAULT/.obsidian/plugins/blyg-publisher/manifest.json"
```

If they'd rather not use `curl | bash`, download the three files from `https://github.com/brndnpink/blyg-publisher/releases/latest/download/<file>` and copy them yourself.

## Step 3: Enable it (human)

Tell them:
- Open **Settings → Community plugins**. If community plugins are off, turn them on; Obsidian shows its own confirmation.
- Click the reload icon next to *Installed plugins*, then enable **Blyg Publisher**.
- A feather icon appears in the left ribbon. It opens the Blyg panel on the right.

## Step 4: Choose the mode, make the publish folder, configure

Ask: **"Do you already have a blyg, with a studio you log in to?"** Also ask what to call the **publish folder** (default `Blyg`). It must be a single top-level folder (no slashes, not hidden), and **only notes in it can ever be published**, so it should be dedicated and hold nothing private.

```bash
mkdir -p "$VAULT/Blyg/fragments" "$VAULT/Blyg/threads"
```

Settings live in `"$VAULT/.obsidian/plugins/blyg-publisher/data.json"`. **Merge** into an existing file; never overwrite it:

```bash
python3 - "$VAULT/.obsidian/plugins/blyg-publisher/data.json" <<'EOF'
import json, os, sys
p = sys.argv[1]
d = json.load(open(p)) if os.path.exists(p) else {}
d.update({
  "target": "server",                        # or "static"
  "origin": "https://example.com/blyg/",     # their blyg's public address, ending in /
  "publishFolder": "Blyg",
  "nameScan": False,
})
json.dump(d, open(p, "w"), indent=2)
EOF
```

**After editing `data.json`, ask them to toggle Blyg Publisher off and on** (Obsidian reads settings when the plugin loads). They can change everything later in Settings → Blyg Publisher.

| Key | Mode | What to ask / set |
|---|---|---|
| `target` | both | `"server"` if they have a blyg, else `"static"` |
| `origin` | both | Existing blyg: its public address, the page listing their fragments and threads, e.g. `https://example.com/blyg/`. Static: where it will live, e.g. `https://<project>.pages.dev/blyg/`. Must end with `/`. |
| `publishFolder` | both | The folder from above |
| `nameScan` | both | Flag emails, phone numbers, "IEP", "504", and listed names before publishing? Recommend `true` for anyone who writes about work involving other people, such as teachers. |
| `denylistPath` | both | Optional private list for the name scan: a text file **outside the publish folder**, one name per line. Don't write names into it unless they give them to you. |
| `title`, `authorName`, `authorBio`, `description` | static | Site title and byline. A pen name is fine. |
| `pagesProject` | static | Cloudflare Pages project name: lowercase letters, digits, and hyphens |
| `homeIntro`, `homeLinks` | static | Optional home page at the domain root; links one per line as `Label \| https://…` |

Check the blyg address (existing-blyg mode). It should serve a Blygger manifest and index:

```bash
ORIGIN="https://example.com/blyg/"
curl -s -o /dev/null -w "blyg.json %{http_code}\n" "${ORIGIN}blyg.json"                  # want 200
curl -s -o /dev/null -w "items/index.json %{http_code}\n" "${ORIGIN}items/index.json"    # want 200
```

## Step 5a: Existing blyg: log in (human)

Tell them: **Settings → Blyg Publisher → Account → Log in…**, or **Log in…** in the panel. They type their studio password there. It's sent once to their blyg and not stored; only the session (about 30 days) is kept, in Obsidian's secure storage. Don't ask them for the password.

That's the whole setup for existing-blyg mode. Go to Step 6.

## Step 5b: Static site: hosting on Cloudflare

1. They need a free Cloudflare account (dash.cloudflare.com/sign-up).
2. Log in the CLI (they approve in the browser), then check:
   ```bash
   npx wrangler@4 login
   npx wrangler@4 whoami
   ```
3. Create the Pages project (with their OK):
   ```bash
   npx wrangler@4 pages project create "<pagesProject>" --production-branch main
   ```
4. Optional custom domain: they attach it in the dashboard under **Workers & Pages → project → Custom domains**. Otherwise `origin` uses `https://<pagesProject>.pages.dev/…`.

## Step 6: First publish (walk them through it)

1. In Obsidian they open or create a note in the publish folder and click **Make fragment** in the Blyg panel. To start from an existing private note, they click **Promote a copy to Blyg…** on it.
2. The panel lists safety checks. Any red ✕ has to be fixed. The panel names the problem.
3. They click **Preview & publish v1**, read the preview, confirm any name-scan matches, and click **Publish**. The note gains a `blyg_id` property.
   - **Existing blyg:** it's live now.
   - **Static:** they then click **Deploy to …** in the panel's Site card. On the first deploy, they switch on **"This is the first deploy."**

## Step 7: Verify (you can do this)

```bash
ORIGIN="https://example.com/blyg/"
curl -s "${ORIGIN}items/index.json"     # their new item's id (from the note's blyg_id) should be listed
```

Static mode, full check:

```bash
for p in "" blyg.json feed.xml items/index.json; do printf "%-18s " "${p:-(page)}"; curl -s -o /dev/null -w "%{http_code}\n" "$ORIGIN$p"; done
curl -s -o /dev/null -w "unknown id -> %{http_code} (want 404)\n" "${ORIGIN}items/00000000000000000000000000.json"
curl -sI "${ORIGIN}blyg.json" | grep -i access-control-allow-origin    # want: *
```

## Everyday workflow (reference)

| Action | Where | Notes |
|---|---|---|
| Promote a copy | Panel, on a private note | Copies the body into `<folder>/fragments/` or `threads/`. The original is untouched and its properties are left behind. |
| Make fragment / Make thread | Panel, on an unmarked note in the folder | Sets `blyg: publish` and `blyg_kind`. |
| Embed a fragment in a thread | Panel → *Embed a fragment* → insert | Inserts `![[Note name]]` on its own line, adding the folder path if another note shares the name. Only published fragments can be embedded. |
| Preview & publish | Panel, or the command palette's "Preview and publish current note…" | Existing blyg: live immediately. Static: recorded locally until Deploy. |
| View a version | Click a version in the panel | Existing blyg: live and pinned text; older text stays in their studio. Static: every version, privately. |
| Pin | Panel → Pin… | Permanent public copy. **Irreversible.** |
| Withdraw | Panel → Withdraw… | Publishes an empty "withdrawn" version. Pins stay. Reversible by publishing again. |
| Deploy | Panel → Site → Deploy… (static only) | Checks the live site first and refuses rollbacks. |
| Log in / Log out | Panel or settings (existing blyg) | Password used once; the session is kept in secure storage. |

Note properties: `blyg: publish` (opt-in), `blyg_kind` (`fragment` or `thread`, fixed after first publish), `blyg_id` (written by the plugin; never edit or duplicate it), `blyg_title` (optional title).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "Create a folder named … at the top of your vault" | The publish folder is missing or misnamed. Create it or fix `publishFolder`. |
| "Couldn't read your blyg at …" / "No blyg found at …" | Wrong `origin`. It must be the blyg's public address, the one serving `blyg.json` and `items/index.json`. Check with the curl commands in Step 4. |
| "No blyg studio found at …/studio" when logging in | The blyg isn't a reference-server blyg, or `origin` points somewhere else. Existing-blyg mode needs the reference server's studio and API. Otherwise use static mode. |
| "Wrong password." | They should retype it. You don't handle it. |
| "Your blyg session expired" | They log in again. Sessions last about 30 days. |
| "Links to a private note outside …" | Any `[[link]]` or `![[embed]]` to a note outside the publish folder is refused. Remove it, or promote that note and link the copy. |
| "A note in … has the same name, but this link finds the private one" | Promote keeps the name, so the link is ambiguous. Use the panel's insert button, or the full path it suggests. |
| "Another note has the same blyg_id" | A published note was duplicated. Remove `blyg_id` from the copy. |
| Publish error "one or more transclusions do not resolve" | A thread embeds something the blyg can't find (unpublished or withdrawn). Publish the fragment first, or remove the embed. |
| "Can't read the private name list" | `denylistPath` is wrong or unreadable. Fix it, or clear it (the built-in patterns still run). |
| Static: "Wrangler isn't logged in" / no Pages project | Step 5b. |
| Static: deploy refuses a rollback, or "pinned online but not in the ledger" | The local ledger is older than what's live. Restore the newest ledger from `<folder>/.blyg/backups/` or the other computer. Never force it. |
| Images refused | Not supported yet. Link to images hosted elsewhere with `![alt](https://…)`. |

## Updating and uninstalling

- **Update:** re-run the Step 2 installer, then have them toggle the plugin off and on.
- **Uninstall:** they disable the plugin, then you remove `"$VAULT/.obsidian/plugins/blyg-publisher/"`. Leave the publish folder alone unless they ask. Existing-blyg items stay on their blyg; static sites stay up until they delete the Pages project.

## Working on the code

See **Building from source** in [README.md](README.md). Everything that uses the network is under `src/deploy/`, including the reference-server client in `server.ts`, and a test enforces this. To test against a local reference server, see the header of `test/server.integration.test.ts`.
