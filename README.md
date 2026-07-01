# apothecary-agent

Read-only Vault Reviewer for local Markdown knowledge bases.

v0.1 focuses on scanning a local vault and generating safe `.agent/` artifacts. It does not modify user notes.

## Development

```bash
pnpm install
pnpm run build
pnpm run dev -- init --vault ./demo-vault
pnpm run dev -- status --vault ./demo-vault
```

`init` creates `.agent/config.yaml` plus protocol files. v0.1 reads this YAML config for scan ignore patterns, hash behavior, status recent-file limits, map size limits, and deterministic review thresholds.
