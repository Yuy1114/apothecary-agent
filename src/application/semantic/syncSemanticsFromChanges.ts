import { promises as fs } from "node:fs";
import path from "node:path";
import { hashFile } from "../../vault/hash.js";
import { parseMarkdownSnapshot } from "../../vault/markdown.js";
import { listPendingChanges, type PendingChange } from "../../vault/changeLog.js";
import {
  loadSummaries,
  saveSummaries,
  saveGraph,
  upsertSummary,
} from "../../vault/semanticStore.js";
import { buildSemanticGraph } from "../../domain/semanticGraph.js";
import { refreshRelations } from "./refreshRelations.js";
import { generateFileSummary } from "./generateFileSummary.js";
import { mapWithConcurrency, withTimeout } from "../../utils/concurrency.js";
import { planSemanticSync, type ChangedFileState } from "./planSemanticSync.js";
import type { FileSummary } from "../../domain/semantic.js";

const CONCURRENCY = Number(process.env.APOTHECARY_SEMANTIC_CONCURRENCY ?? 8);
const PER_FILE_TIMEOUT_MS = Number(process.env.APOTHECARY_SEMANTIC_TIMEOUT_MS ?? 90_000);

export type SemanticSyncReport = {
  /** Distinct changed paths considered this pass. */
  scanned: number;
  /** Summaries regenerated for new/edited files. */
  refreshed: number;
  /** Summaries dropped for deleted files. */
  pruned: number;
  /** Up-to-date markdown + ignored non-markdown paths that needed no work. */
  skipped: number;
  /** Files whose summary generation failed or timed out. */
  failed: number;
  topics: number;
  concepts: number;
};

const EMPTY_REPORT: SemanticSyncReport = {
  scanned: 0,
  refreshed: 0,
  pruned: 0,
  skipped: 0,
  failed: 0,
  topics: 0,
  concepts: 0,
};

/** Injection seam so the impure summary generator can be stubbed in tests. */
type Deps = {
  listPendingChanges: () => Promise<PendingChange[]>;
  summarize: typeof generateFileSummary;
};

function isMarkdownPath(p: string): boolean {
  return /\.(md|markdown)$/i.test(p);
}

/** Read the disk state (and, for markdown, content) needed to plan and refresh. */
async function gatherFile(
  vaultPath: string,
  relPath: string,
): Promise<{ state: ChangedFileState; content?: string; title?: string }> {
  if (!isMarkdownPath(relPath)) {
    return { state: { path: relPath, exists: false, hash: null, isMarkdown: false } };
  }

  const absolutePath = path.join(vaultPath, relPath);
  let content: string;
  try {
    content = await fs.readFile(absolutePath, "utf8");
  } catch {
    // Missing/unreadable → treat as a deletion for pruning purposes.
    return { state: { path: relPath, exists: false, hash: null, isMarkdown: true } };
  }

  const hash = await hashFile(absolutePath);
  const title = parseMarkdownSnapshot(relPath, content).title;
  return { state: { path: relPath, exists: true, hash, isMarkdown: true }, content, title };
}

/**
 * Change-driven incremental refresh of the semantic layer (Cap3 linkage).
 *
 * Reads the pending change queue and refreshes summaries for exactly the
 * affected files — new/edited files get a fresh summary, deleted files are
 * pruned, then the derived semantic graph is rebuilt. Idempotent: an unchanged
 * file is skipped via its content hash, so this is safe to run repeatedly (e.g.
 * debounced from the watcher).
 *
 * It deliberately does NOT resolve the change ledger: those pending rows remain
 * the curator's human-facing triage queue. This keeps "semantic layer is fresh"
 * and "a human/agent has reviewed the change" as separate concerns.
 */
export async function syncSemanticsFromChanges(
  input: { vaultPath: string },
  deps: Deps = { listPendingChanges, summarize: generateFileSummary },
): Promise<SemanticSyncReport> {
  const changes = await deps.listPendingChanges();
  if (changes.length === 0) return EMPTY_REPORT;

  // The ledger dedupes pending rows per path, but collapse defensively anyway.
  const paths = [...new Set(changes.map((c) => c.path))];

  const gathered = await mapWithConcurrency(paths, CONCURRENCY, (relPath) =>
    gatherFile(input.vaultPath, relPath),
  );
  const byPath = new Map(gathered.map((g) => [g.state.path, g]));

  let summaries = await loadSummaries(input.vaultPath);
  const plan = planSemanticSync(
    gathered.map((g) => g.state),
    summaries,
  );

  // Regenerate summaries for new/edited files with a bounded worker pool so a
  // burst of edits doesn't fan out into unbounded concurrent LLM calls.
  const outcomes = await mapWithConcurrency(plan.toRefresh, CONCURRENCY, async (relPath) => {
    const file = byPath.get(relPath);
    if (!file?.content) return null;
    try {
      return await withTimeout(
        deps.summarize({
          path: relPath,
          title: file.title ?? relPath,
          content: file.content,
          contentHash: file.state.hash ?? "",
        }),
        PER_FILE_TIMEOUT_MS,
      );
    } catch {
      return null;
    }
  });

  let refreshed = 0;
  let failed = 0;
  for (const outcome of outcomes as (FileSummary | null)[]) {
    if (outcome) {
      summaries = upsertSummary(summaries, outcome);
      refreshed += 1;
    } else {
      failed += 1;
    }
  }

  for (const relPath of plan.toPrune) {
    const { [relPath]: _removed, ...rest } = summaries;
    summaries = rest;
  }

  const graph = buildSemanticGraph(summaries);

  // Only persist when the layer actually changed; unchanged passes stay read-only.
  if (refreshed > 0 || plan.toPrune.length > 0) {
    await saveSummaries(input.vaultPath, summaries);
    await saveGraph(input.vaultPath, graph);
    await refreshRelations(input.vaultPath, graph);
  }

  return {
    scanned: paths.length,
    refreshed,
    pruned: plan.toPrune.length,
    skipped: plan.upToDate.length + plan.ignored.length,
    failed,
    topics: graph.topics.length,
    concepts: graph.concepts.length,
  };
}
