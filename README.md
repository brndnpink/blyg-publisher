# Blyg Publisher

An Obsidian plugin that publishes a [Blygger](https://blygger.org) blyg (protocol v0.2) from a
single folder of your vault to a static host. Local-first: no server of its own.

Status: early development. Desktop only.

## Develop

```bash
npm install
npm run install-plugin   # type-check, build, copy into the vault's plugin folder
```

Set the target vault with `BLYG_VAULT=/path/to/vault` or a gitignored `local.config.json`
containing `{"vault": "/path/to/vault"}`.

## Safety model

Only notes inside the `7 - Blyg/` folder that carry `blyg: publish` in their frontmatter can ever
be published. The folder is a constant in the code, not a setting.
