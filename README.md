# apothecary-agent

Mastra-native agent for local Markdown knowledge bases.

The project is developed and tested through Mastra Studio. Local vault access is configured through `APOTHECARY_VAULT_PATH`, falling back to `/Users/yuy/apothecary-vault` for Yuy's local setup.

## Development

```bash
pnpm install
pnpm run build
pnpm run dev
```

The vault-local `.agent/config.yaml` remains the editable knowledge-maintenance config. It controls scan ignore patterns, hash behavior, status recent-file limits, map size limits, and deterministic review thresholds.
