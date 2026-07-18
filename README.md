# apothecary-agent

A local, Mastra-native agent that maintains a **two-layer apothecary** for a personal Markdown knowledge base:

- a **human-readable physical layer** — your real Markdown files, kept clean and navigable;
- an **agent semantic layer** (`.agent/`) — the agent's own understanding: per-file summaries, a topic/concept graph, typed relations, duplicate clusters, canonical candidates, and a standing knowledge profile.

It is not a RAG demo. The product promise is: **continuously maintain a high signal-to-noise personal knowledge profile**, and — critically — **every change an AI makes to your notes is safe, reviewable, and auditable**. Real file writes, moves, merges and archives only happen through an approved proposal.

## The core loop

```
new knowledge / file / manual edit
        ↓  the agent perceives the change
        ↓  updates its semantic layer
        ↓  understands the impact on the knowledge profile
        ↓  generates a reviewable proposal (or a knowledge-system view)
   Yuy approves the actions worth taking
        ↓  applied safely to the physical layer
        ↓  index, ledger, profile and semantic layer updated
```

## Capabilities

| # | Capability | What it does |
|---|------------|--------------|
| 1 | Chat / Knowledge Capture | RAG Q&A over the vault with source citations; capture a durable insight from a conversation as a proposal. |
| 2 | Inbox Triage | Understand `inbox/` notes and propose where they belong; moving a note keeps directory README indexes in sync. |
| 3 | Change Awareness / Sync | A file watcher records created/modified/deleted notes; manual sync + snapshot diff recover missed events and re-sync the index and semantic layer. |
| 4 | Semantic Maintenance | File summaries, topic/concept graph, typed relations, duplicate detection/classification, canonical candidates, and a maintenance-findings worklist. |
| 5 | Knowledge Profile & Views | A standing `knowledge-profile.{md,json}` and per-topic knowledge-system views under `.agent/views/`. |
| 6 | Governance & Audit | One unified proposal lifecycle with approval/rejection records and an operation ledger. Permanent deletion has no execution path. |

## Governance: one guarded write path

Every change to the human layer flows through a single **unified proposal** (`.agent/proposals/*.json`) with the lifecycle `proposed → applied | rejected`:

1. **Propose** — `proposeChange` records a typed, reviewable proposal (never applied automatically). Types: `edit`, `move`, `archive`, `merge`, `capture`, `structure`, `view_promotion`, `canonical_note`.
2. **Review** — `listChangeProposals` shows what is pending.
3. **Resolve** — `resolveProposal` (human-approval gated) `approve`s (executes) or `reject`s (records the decision, touches nothing).

On **approve**, the executor:

- validates every payload path stays inside the vault (`safeVaultPath`) — an escaping path is refused;
- applies the change and keeps the vector index in sync;
- runs a **post-apply refresh** of the semantic layer (summaries, graph, relations, canonical candidates) for the affected files before the proposal is marked applied;
- records the operation in the ledger.

If the underlying action fails, the proposal stays `proposed` so it can be fixed and retried — it is never silently lost.

**Consistency is synchronous on the happy path, eventual on failure.** The file change and vector index are always in sync when a proposal is `applied`. The semantic-layer refresh normally completes synchronously too; if it fails (model/network/process exit), the proposal still counts as `applied` (the file change is done) but the affected paths are recorded as durable recovery work (`source: proposal` in the change ledger), retried idempotently by manual sync or `retrySemanticRecovery` — never re-running the file mutation.

### Canonicalization

Scattered concepts are surfaced as **canonical candidates**; a `canonical_note` proposal writes the canonical note and stamps `superseded_by` frontmatter on the notes it replaces (a directed, human-visible link). RAG then **prefers current content and demotes superseded notes**, and `listMaintenanceFindings` reminds you to archive superseded notes still sitting in the active vault.

## Layout

Dependencies point down, and nothing points back up. `pnpm run check` fails if they do.

```
src/
  domain/        pure logic + schemas (proposals, relations, candidates, diff, …)
                   imports nothing but zod
  utils/ safety/ observability/ protocol/
                 leaf helpers (ids, concurrency, path-safety guard, logger)
  config/        vault paths, .agent/config.yaml, db locations
  vault/         filesystem + stores (scanner, semanticStore, proposalStore, ledgers, snapshot, …)
  artifacts/ reports/
                 .agent/ artifact paths; markdown renderers
  application/   use cases (intake, notes, sync, proposals, semantic, views, …)
                   knows nothing about Mastra, LLMs or Electron
    ports/         interfaces the infrastructure must implement
  mastra/        agents, tools, workflows, processors
    adapters/      the implementations of application/ports/
  desktop/       Electron shell; one of the two composition roots
  acceptance/    end-to-end acceptance tests
```

A use case that needs an LLM or the vector index declares a port in
`application/ports/`; `mastra/adapters/` implements it; the composition roots
(`mastra/index.ts` for Studio, `desktop/runtime.ts` for the app) wire them
together. See [`docs/architecture.md`](docs/architecture.md) for the layer
contract, when to inject a port explicitly versus through the registry, and how
the boundaries are enforced.

The agent's understanding lives under `<vault>/.agent/` (`semantic/`, `profile/`, `views/`, `proposals/`, `sync/`); it never leaks into your notes.

## Setup

```bash
pnpm install
```

Configuration is via environment variables (a `.env` is loaded):

| Variable | Purpose | Default |
|----------|---------|---------|
| `APOTHECARY_VAULT_PATH` | Path to the Markdown vault | `/Users/yuy/apothecary-vault` |
| `APOTHECARY_EMBEDDING_API_KEY` / `OPENAI_API_KEY` | Embeddings for the vector index | — |
| `APOTHECARY_EMBEDDING_BASE_URL` / `_MODEL` | Embedding endpoint / model | aihubmix / `text-embedding-3-small` |
| `APOTHECARY_SEMANTIC_SYNC_DEBOUNCE_MS` | Watcher → semantic-sync debounce | `8000` |
| `APOTHECARY_DESKTOP_WATCH` | Set to `0` to skip the desktop's vault watcher (use when running `desktop:dev` next to `mastra dev` so a single watcher owns change detection) | on |

The desktop **系统状态** page verifies DeepSeek, the embedding endpoint, and
local vault permissions. It reports configuration and authentication failures
without exposing API keys to the renderer.

The vault-local `.agent/config.yaml` controls scan-ignore patterns, hash behaviour, recent-file limits, map size limits, and deterministic review thresholds.

On first desktop launch, Apothecary uses the configured vault, a previously
selected vault, or asks you to choose a folder. Use **药柜 → 选择其他药柜…**
to switch later; the app restarts so the entire agent runtime uses the new path.

## Running

The Electron desktop app is the v1.1 product entrance. It provides the unified
agent conversation, changed-file queue, inbox triage, proposal review, and
knowledge-profile views without requiring Mastra Studio:

```bash
pnpm run desktop:dev     # Vite HMR + main/preload watch + Electron auto-restart
pnpm run desktop:install # one-click: build → install to /Applications → launch
```

Mastra Studio remains available as a development and debugging surface:

```bash
pnpm run dev     # Mastra Studio (agents, tools, workflows)
```

## Verifying

```bash
pnpm run check # tsc --noEmit, the renderer tsconfig, and the layer guard
pnpm run test  # vitest (watch); `pnpm vitest run` for a single pass
```

Domain logic and stores are covered by unit tests; `src/acceptance/` holds an end-to-end test that drives a proposal from approval through the physical layer, README index, vector index, semantic layer and operation ledger, asserting they stay consistent. LLM boundaries (embeddings, summarizer) and the vector index are reached through `application/ports/`, so tests install a fake with `setSearchIndex(...)` / `setFileSummarizer(...)` rather than mocking modules — the suite is deterministic and runs without API keys.
