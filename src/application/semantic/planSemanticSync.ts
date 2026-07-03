import type { FileSummaries } from "../../domain/semantic.js";
import { needsRefresh } from "../../vault/semanticStore.js";

/** On-disk state of a changed path, gathered by the orchestrator before planning. */
export type ChangedFileState = {
  /** Relative vault path. */
  path: string;
  /** Whether the file currently exists on disk. */
  exists: boolean;
  /** Content hash when it exists; null for deletions. */
  hash: string | null;
  /** Only markdown files participate in the semantic layer. */
  isMarkdown: boolean;
};

/**
 * Deterministic decision of what a change-driven semantic refresh should do,
 * given the current summary store and the on-disk state of each changed path.
 *
 * - `toRefresh` — markdown files that exist and whose content hash differs from
 *   the stored summary (new or edited): they need a fresh LLM summary.
 * - `toPrune` — markdown paths that no longer exist: their stale summary should
 *   be dropped.
 * - `upToDate` — markdown files whose stored summary already matches the current
 *   hash: nothing to do (this is what makes re-runs cheap and idempotent).
 * - `ignored` — non-markdown paths, which have no place in the semantic layer.
 */
export type SemanticSyncPlan = {
  toRefresh: string[];
  toPrune: string[];
  upToDate: string[];
  ignored: string[];
};

export function planSemanticSync(
  states: ChangedFileState[],
  summaries: FileSummaries,
): SemanticSyncPlan {
  const plan: SemanticSyncPlan = { toRefresh: [], toPrune: [], upToDate: [], ignored: [] };
  const seen = new Set<string>();

  for (const state of states) {
    // The ledger already dedupes pending paths, but guard against duplicates so
    // a path is never both refreshed and pruned in the same pass.
    if (seen.has(state.path)) continue;
    seen.add(state.path);

    if (!state.isMarkdown) {
      plan.ignored.push(state.path);
      continue;
    }

    if (!state.exists) {
      // Only worth pruning if we actually hold a summary for it.
      if (summaries[state.path]) plan.toPrune.push(state.path);
      else plan.ignored.push(state.path);
      continue;
    }

    if (needsRefresh(summaries, state.path, state.hash ?? "")) {
      plan.toRefresh.push(state.path);
    } else {
      plan.upToDate.push(state.path);
    }
  }

  return plan;
}
