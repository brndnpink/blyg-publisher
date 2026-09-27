# AGENTS.md: setting up Blyg Publisher for a person

You are helping a person install and use **Blyg Publisher**, an Obsidian plugin that publishes a [Blygger](https://blygger.org) blyg from one folder of their vault to Cloudflare Pages. This file is your runbook, from "here's the repo" to a working, deployed blyg. The human-oriented overview is [README.md](README.md). Read its **Workflow** and **Safety** sections before you start.

## Ground rules

1. **Publishing is public and effectively permanent.** Never publish, deploy, pin, withdraw, or run *Start over* on the person's behalf. Those are their clicks, in Obsidian, after they've seen the preview. You may explain, prepare, check, and verify.
2. **Don't read, move, or quote the person's private notes** beyond what a step needs. The plugin publishes only from one folder; keep your own work to that folder, the plugin folder, and the settings file.
3. **Never hand-edit** `<publish folder>/.blyg/ledger.json`, or `blyg_id` properties in notes. The ledger is the publishing history the plugin's safety checks depend on.
4. **Ask before anything that creates accounts, spends money, or changes their Cloudflare account.** That covers buying a domain, creating a Pages project, and attaching a domain. Running commands they've approved is fine.
5. **Credentials stay with the person.** Cloudflare login happens in their browser through `wrangler login`. Never ask for or handle passwords or API tokens.

## Human-only steps (tell them clearly when you reach one)

- Turning on community plugins and enabling **Blyg Publisher** in Obsidian's settings.
- Approving `wrangler login` in the browser.
- Buying a domain, and attaching it to the Pages project in the Cloudflare dashboard.
- Every **Publish**, **Pin**, **Withdraw**, **Deploy**, and **Start over** click.

## Step 0: Check prerequisites

```bash
sw_vers -productName        # expect macOS; deploy is untested on Linux, unsupported on Windows
node --version              # needed for deploying (npx); v18+
npx --version
```

The plugin needs Obsidian **desktop** 1.7.2 or newer.

## Step 1: Find the vault

Ask the person which vault to use. On macOS, Obsidian lists its vaults here:

```bash
python3 -c "import json,os;[print(v['path']) for v in json.load(open(os.path.expanduser('~/Library/Application Support/obsidian/obsidian.json')))['vaults'].values()]"
```

Confirm the path with them. A vault contains a `.obsidian/` folder. Below, `$VAULT` means that path, quoted when used, since vault paths often contain spaces and apostrophes.

## Step 2: Install the plugin

```bash
curl -fsSL https://raw.githubusercontent.com/brndnpink/blyg-publisher/main/scripts/install.sh | bash -s -- "$VAULT"
```

This downloads the latest release's `main.js`, `manifest.json`, and `styles.css` into `"$VAULT/.obsidian/plugins/blyg-publisher/"`. It never touches `data.json` (settings) or notes. Re-running it updates the plugin.

Verify:

```bash
ls "$VAULT/.obsidian/plugins/blyg-publisher/"                  # main.js  manifest.json  styles.css
grep '"version"' "$VAULT/.obsidian/plugins/blyg-publisher/manifest.json"
```

If `curl | bash` isn't acceptable to the person, download the three files from `https://github.com/brndnpink/blyg-publisher/releases/latest/download/<file>` and copy them yourself.

## Step 3: Enable it (human)

Tell the person:
- Open **Settings → Community plugins**. If community plugins are off, turn them on; Obsidian shows its own confirmation.
- Click the reload icon next to *Installed plugins*, then enable **Blyg Publisher**.
- A feather icon appears in the left ribbon. Clicking it opens the Blyg panel on the right.

Optional, only if Obsidian is **closed** and community plugins were already on in this vault: add `"blyg-publisher"` to the JSON array in `"$VAULT/.obsidian/community-plugins.json"`. Create the file as `["blyg-publisher"]` if it's missing. Otherwise let them click.

## Step 4: Make the publish folder

Ask what the folder should be called. The default is `Blyg`. It must be a single top-level folder (no slashes, not hidden). **Only notes in it can ever be published**, so it should be a dedicated folder that holds nothing private.

```bash
mkdir -p "$VAULT/Blyg/fragments" "$VAULT/Blyg/threads"
```

The plugin keeps its private state in `Blyg/.blyg/` (the ledger, backups, and a deploy log). Leave that folder alone.

## Step 5: Configure

Ask the person for:

| Setting (`data.json` key) | What to ask | Example |
|---|---|---|
| `origin` | Where the blyg will live. Must be `https://` and end with `/`. With a domain: `https://theirdomain.com/blyg/`. Without one: `https://<project>.pages.dev/blyg/`. | `https://example.com/blyg/` |
| `title` | Site title | `Notes in Public` |
| `authorName` | Byline. A pen name is fine; nothing else identifying is published. | `A. Writer` |
| `authorBio`, `description` | Optional one-liners | |
| `pagesProject` | Cloudflare Pages project name: lowercase letters, digits, and hyphens | `notes-in-public` |
| `publishFolder` | From Step 4 | `Blyg` |
| `nameScan` | Flag emails, phone numbers, "IEP", "504", and listed names before publishing? Recommend **true** for anyone who writes about work involving other people, such as teachers. | `true` |
| `denylistPath` | Optional private list for the name scan: a text file **outside the publish folder**, one name per line. | `~/Documents/blyg-names.txt` |
| `homeIntro`, `homeLinks` | Optional home page at the domain root (only when `origin` has a path such as `/blyg/`). Links go one per line as `Label \| https://…`. | |
| `outputDir` | Leave empty (a temp folder is used) | |

Write the settings to `"$VAULT/.obsidian/plugins/blyg-publisher/data.json"`. **Merge** with any existing file rather than overwriting it:

```bash
python3 - "$VAULT/.obsidian/plugins/blyg-publisher/data.json" <<'EOF'
import json, os, sys
p = sys.argv[1]
d = json.load(open(p)) if os.path.exists(p) else {}
d.update({
  "origin": "https://example.com/blyg/",
  "title": "Notes in Public",
  "authorName": "A. Writer",
  "pagesProject": "notes-in-public",
  "publishFolder": "Blyg",
  "nameScan": True,
})
json.dump(d, open(p, "w"), indent=2)
EOF
```

Obsidian reads settings when the plugin loads. **After editing `data.json`, ask the person to toggle Blyg Publisher off and on.** They can also change everything later in Settings → Blyg Publisher.

If they chose a name list, create it if needed and let them fill it in. Don't write names into it yourself unless they give them to you.

## Step 6: Hosting on Cloudflare

1. **Account:** the person needs a free Cloudflare account (dash.cloudflare.com/sign-up). Suggest turning on two-factor authentication.
2. **Log in the CLI** (they approve in the browser):
   ```bash
   npx wrangler@4 login
   npx wrangler@4 whoami        # should show their account
   ```
3. **Create the Pages project** (with their OK):
   ```bash
   npx wrangler@4 pages project create "<pagesProject>" --production-branch main
   ```
4. **Domain (optional):**
   - If they have one on Cloudflare, they attach it in the dashboard: **Workers & Pages → project → Custom domains → Set up a custom domain**. DNS usually works within minutes, occasionally longer.
   - If not, `origin` must use `https://<pagesProject>.pages.dev/…`, which works as soon as the first deploy finishes.

## Step 7: First publish and deploy (walk them through it)

1. In Obsidian, they open or create a note in the publish folder and click **Make fragment** in the Blyg panel. To start from an existing private note, they open it and click **Promote a copy to Blyg…**.
2. The panel lists safety checks. Any red ✕ has to be fixed. The panel names the problem.
3. They click **Preview & publish v1**, read the preview, confirm any name-scan matches, and click **Publish**. The note gains a `blyg_id` property.
4. They click **Deploy to …** in the panel's Site card. On the very first deploy, the live site can't be checked yet, so they switch on **"This is the first deploy"**. The log ends with *Done*.

## Step 8: Verify (you can do this)

With `ORIGIN` set to their `origin` value:

```bash
ORIGIN="https://example.com/blyg/"
for p in "" blyg.json feed.xml items/index.json style.css; do printf "%-18s " "${p:-(page)}"; curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "$ORIGIN$p"; done
curl -s -o /dev/null -w "unknown id -> %{http_code} (want 404)\n" "${ORIGIN}items/00000000000000000000000000.json"
curl -sI "${ORIGIN}blyg.json" | grep -i access-control-allow-origin    # want: *
curl -s "${ORIGIN}items/index.json"                                     # lists what they published
```

Expect `200` for the page, `blyg.json`, `feed.xml`, `items/index.json`, and `style.css`; `404` for the unknown id; and `access-control-allow-origin: *`. If the domain returns nothing yet, check the `*.pages.dev` address. A fresh domain can take a little while, and the Mac's DNS cache can hold an old "not found" for a few minutes.

Optional: they can list the blyg at [blygger.com](https://blygger.com) (a public directory; their decision) and subscribe to `<origin>feed.xml` in any RSS reader.

## Everyday workflow (reference)

| Action | Where | Notes |
|---|---|---|
| Promote a copy | Panel, on a private note | Copies the body into `<folder>/fragments/` or `threads/`. The original is untouched and its properties are left behind. |
| Make fragment / Make thread | Panel, on an unmarked note in the folder | Sets `blyg: publish` and `blyg_kind`. |
| Embed a fragment in a thread | Panel → *Embed a fragment* → insert | Inserts `![[Note name]]` on its own line, adding the folder path if another note shares the name. Only published fragments can be embedded. |
| Preview & publish | Panel, or the command palette's "Preview and publish current note…" | Records a new version in the ledger. Not online until the next deploy. |
| View a version | Click a version in the panel | Private view with its text, what changed, and whether it's public (current / pinned) or private. |
| Pin | Panel → Pin… | Permanent public copy at `<origin>items/<id>/v<n>.json` and `…/v<n>/`. **Irreversible.** |
| Withdraw | Panel → Withdraw… | Publishes an empty "withdrawn" version. Pins stay. Reversible by publishing again. |
| Deploy | Panel → Site → Deploy… | Checks the live site first and refuses rollbacks. |
| Start over | Command palette | Clears test publishes. **Only allowed before the first deploy.** |

Note properties: `blyg: publish` (opt-in), `blyg_kind` (`fragment` or `thread`, fixed after first publish), `blyg_id` (written by the plugin; never edit or duplicate it), `blyg_title` (optional public title; otherwise the note's name is used).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Panel says "Create a folder named … at the top of your vault" | The publish folder is missing or misnamed. Create it or fix `publishFolder`. |
| "Links to a private note outside …" | Any `[[link]]` or `![[embed]]` to a note outside the publish folder is refused. Remove it, or promote that note and link the copy. |
| "A note in … has the same name, but this link finds the private one" | Promote keeps the name, so the link is ambiguous. Use the panel's insert button, or the full path it suggests. |
| "Another note has the same blyg_id" | A published note was duplicated. Remove `blyg_id` from the copy. |
| "This note has a blyg_id the ledger doesn't know" | The ledger was replaced or rolled back (sync or restore). Restore the newest `ledger*.json` from `<folder>/.blyg/backups/`. Don't invent ids. |
| "Sync conflict in the ledger folder" | Two computers wrote the ledger. Compare the conflicted copy with `ledger.json`, keep the one with more versions, and move the other into `backups/`. Ask the person first. |
| "Can't read the private name list" | `denylistPath` is wrong, or the file is unreadable. Fix the path, or clear it (the built-in patterns still run). |
| Deploy: "Wrangler isn't logged in" | Run `npx wrangler@4 login` (the person approves in the browser). |
| Deploy: no Pages project named … | Create it (Step 6.3) or fix `pagesProject`. |
| Deploy refuses: "would roll it back" / "pinned online but not in the ledger" | The local ledger is older than what's live. Restore the newest ledger from backups or from the other computer. Never force it. |
| Images refused | Not supported yet. Link to images hosted elsewhere with `![alt](https://…)`. |

## Updating and uninstalling

- **Update:** re-run the Step 2 installer, then have the person toggle the plugin off and on.
- **Uninstall:** they disable the plugin in Obsidian, then you remove `"$VAULT/.obsidian/plugins/blyg-publisher/"`. Leave the publish folder and its `.blyg/` state unless they ask; that's their publishing history. The live site stays up until they delete the Pages project in Cloudflare.

## Working on the code

See **Building from source** in [README.md](README.md). The protocol rules are in `src/core/` and the publishing rules in `src/safety/`. `npm test` runs everything that doesn't need Obsidian. Network access is allowed only under `src/deploy/`, and a test enforces this.
