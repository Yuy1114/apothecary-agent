import type { SemanticGraph } from "../../domain/semantic.js";
import { buildRelations } from "../../domain/relations.js";
import { buildCanonicalCandidates } from "../../domain/canonicalCandidates.js";
import {
  loadDuplicateReport,
  saveRelations,
  saveCanonicalCandidates,
} from "../../vault/semanticStore.js";
import { markProfileDirty } from "../../vault/profileState.js";

/**
 * Rebuild and persist the derived relation artifacts from the current graph and
 * whatever duplicate report exists: the typed relation layer and, on top of it,
 * the canonical-candidate list. Deterministic and cheap (no LLM) — called
 * wherever the semantic graph is (re)built so both stay in step with it.
 */
export async function refreshRelations(
  vaultPath: string,
  graph: SemanticGraph,
): Promise<{ relations: number; canonicalCandidates: number }> {
  const dupReport = await loadDuplicateReport(vaultPath);

  const relations = buildRelations(graph, dupReport);
  await saveRelations(vaultPath, relations);

  const candidates = buildCanonicalCandidates(graph, relations);
  await saveCanonicalCandidates(vaultPath, candidates);

  // The semantic layer changed, so the standing profile is now stale.
  await markProfileDirty(vaultPath);

  return { relations: relations.relations.length, canonicalCandidates: candidates.candidates.length };
}
