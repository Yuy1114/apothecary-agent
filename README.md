# apothecary-agent

Read-only Vault Reviewer for local Markdown knowledge bases.

v0.1 focuses on scanning a local vault and generating safe `.agent/` artifacts. It does not modify user notes.

## Development

```bash
pnpm install
pnpm run build
pnpm run dev -- status
```

The project-level `apothecary.config.yaml` stores the default vault path:

```yaml
vault:
  path: /Users/yuy/Apothecary-Vault
```

All commands also accept `--vault <path>` to override that default.

`init` creates `.agent/config.yaml` plus protocol files inside the target vault. v0.1 reads the vault-local YAML config for scan ignore patterns, hash behavior, status recent-file limits, map size limits, and deterministic review thresholds.
