// Copies the built plugin into a vault's plugin folder.
// The vault comes from BLYG_VAULT, or from "vault" in local.config.json
// (gitignored, so personal paths stay out of the repo).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

let vault = process.env.BLYG_VAULT;
if (!vault && existsSync("local.config.json")) {
	vault = JSON.parse(readFileSync("local.config.json", "utf8")).vault;
}
if (!vault) {
	console.error('Set BLYG_VAULT or create local.config.json with {"vault": "/path/to/vault"}.');
	process.exit(1);
}
if (!existsSync(join(vault, ".obsidian"))) {
	console.error(`Not an Obsidian vault: ${vault}`);
	process.exit(1);
}

const dest = join(vault, ".obsidian/plugins/blyg-publisher");
mkdirSync(dest, { recursive: true });
for (const file of ["manifest.json", "main.js"]) {
	copyFileSync(file, join(dest, file));
}
console.log(`Installed to ${dest}`);
