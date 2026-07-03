import type { SemanticGraph } from "../../domain/semantic.js";
import { buildRelations } from "../../domain/relations.js";
import { loadDuplicateReport, saveRelations } from "../../vault/semanticStore.js";

/**
 * Rebuild and persist the typed relation artifact from the current graph and
 * whatever duplicate report exists. Deterministic and cheap (no LLM) — called
 * wherever the semantic graph is (re)built so relations stay in step with it.
 */
export async function refreshRelations(vaultPath: string, graph: SemanticGraph): Promise<number> {
  const dupReport = await loadDuplicateReport(vaultPath);
  const artifact = buildRelations(graph, dupReport);
  await saveRelations(vaultPath, artifact);
  return artifact.relations.length;
}
