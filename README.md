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
- runs a **synchronous post-apply refresh** of the semantic layer for the affected files *before* the proposal is marked applied;
- records the operation in the ledger.

If the underlying action fails, the proposal stays `proposed` so it can be fixed and retried — it is never silently lost.

### Canonicalization

Scattered concepts are surfaced as **canonical candidates**; a `canonical_note` proposal writes the canonical note and stamps `superseded_by` frontmatter on the notes it replaces (a directed, human-visible link). RAG then **prefers current content and demotes superseded notes**, and `listMaintenanceFindings` reminds you to archive superseded notes still sitting in the active vault.

## Layout

```
src/
  domain/        pure logic + schemas (proposals, relations, candidates, diff, …)
  application/   orchestration without agent/tool coupling (semantic, profile, maintenance, …)
  vault/         filesystem + stores (scanner, semanticStore, proposalStore, ledgers, snapshot, …)
  mastra/        agents, tools, workflows, processors
  safety/        path-safety guard
  acceptance/    end-to-end acceptance tests
```

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

The vault-local `.agent/config.yaml` controls scan-ignore patterns, hash behaviour, recent-file limits, map size limits, and deterministic review thresholds.

## Running

The agent is developed and driven through **Mastra Studio**:

```bash
pnpm run dev     # Mastra Studio (agents, tools, workflows)
```

## Verifying

```bash
pnpm run check   # tsc --noEmit
pnpm run test    # vitest (watch)
pnpm run ci      # check + build + vitest run
```

Domain logic and stores are covered by unit tests; `src/acceptance/` holds an end-to-end test that drives a proposal from approval through the physical layer, README index, vector index, semantic layer and operation ledger, asserting they stay consistent. LLM boundaries (embeddings, summarizer) are stubbed so the suite is deterministic and runs without API keys.
