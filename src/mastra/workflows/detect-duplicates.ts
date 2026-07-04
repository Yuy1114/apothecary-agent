import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { ensureAgentArtifacts } from "../../artifacts/agentArtifacts.js";
import { loadGraph, loadSummaries } from "../../vault/semanticStore.js";
import {
  findDuplicateCandidates,
  type DuplicateCluster,
  type DuplicateReport,
} from "../../domain/duplicateDetection.js";
import { classifyDuplicate } from "../../application/duplicates/classifyDuplicate.js";
import { refreshRelations } from "../../application/semantic/refreshRelations.js";
import { renderDuplicateReportMarkdown } from "../../reports/renderDuplicateReportMarkdown.js";
import { mapWithConcurrency, withTimeout } from "../../utils/concurrency.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";

const CONCURRENCY = Number(process.env.APOTHECARY_SEMANTIC_CONCURRENCY ?? 8);
const PER_ITEM_TIMEOUT_MS = Number(process.env.APOTHECARY_SEMANTIC_TIMEOUT_MS ?? 90_000);
const MAX_CANDIDATES = Number(process.env.APOTHECARY_DUP_MAX_CANDIDATES ?? 60);

const OutputSchema = z.object({
  candidates: z.number(),
  harmful: z.number(),
  contextual: z.number(),
  evolutionary: z.number(),
  notDuplicate: z.number(),
  failed: z.number(),
});

const resolveVaultStep = createStep({
  id: "resolve-vault",
  inputSchema: z.object({ vaultPath: z.string(), minSharedConcepts: z.number().optional() }),
  outputSchema: z.object({ vaultPath: z.string(), minSharedConcepts: z.number().optional() }),
  execute: async ({ inputData }) => ({
    vaultPath: await resolveExistingDirectory(inputData.vaultPath),
    minSharedConcepts: inputData.minSharedConcepts,
  }),
});

const detectStep = createStep({
  id: "detect-duplicates",
  inputSchema: z.object({ vaultPath: z.string(), minSharedConcepts: z.number().optional() }),
  outputSchema: OutputSchema,
  execute: async ({ inputData }) => {
    // Duplicate detection reads/writes the semantic layer in the global agent
    // home; the vault is only validated (resolveVaultStep), not read here.
    const home = apothecaryHome();
    const [graph, summaries] = await Promise.all([loadGraph(home), loadSummaries(home)]);

    if (graph.concepts.length === 0) {
      throw new Error("Semantic graph is empty. Run the refresh-semantics workflow first.");
    }

    const candidates = findDuplicateCandidates(graph, {
      minSharedConcepts: inputData.minSharedConcepts,
    }).slice(0, MAX_CANDIDATES);

    const outcomes = await mapWithConcurrency(candidates, CONCURRENCY, async (candidate) => {
      try {
        const draft = await withTimeout(
          classifyDuplicate({
            files: candidate.files,
            sharedConcepts: candidate.sharedConcepts,
            summaries,
          }),
          PER_ITEM_TIMEOUT_MS,
        );
        const cluster: DuplicateCluster = {
          files: candidate.files,
          sharedTopics: candidate.sharedTopics,
          sharedConcepts: candidate.sharedConcepts,
          ...draft,
        };
        return cluster;
      } catch {
        return null;
      }
    });

    const clusters = outcomes.filter((c): c is DuplicateCluster => c !== null);
    const failed = outcomes.length - clusters.length;

    const report: DuplicateReport = { generatedAt: new Date().toISOString(), clusters };
    const artifacts = await ensureAgentArtifacts();
    await fs.writeFile(
      path.join(artifacts.semanticDir, "duplicate-clusters.json"),
      JSON.stringify(report, null, 2),
      "utf8",
    );
    await fs.writeFile(
      path.join(artifacts.semanticDir, "duplicate-clusters.md"),
      renderDuplicateReportMarkdown(report),
      "utf8",
    );

    // Fold the fresh classifications into the typed relation layer.
    await refreshRelations(home, graph);

    const count = (c: DuplicateCluster["classification"]) =>
      clusters.filter((cluster) => cluster.classification === c).length;

    return {
      candidates: candidates.length,
      harmful: count("harmful_duplicate"),
      contextual: count("contextual_repetition"),
      evolutionary: count("evolutionary_duplicate"),
      notDuplicate: count("not_duplicate"),
      failed,
    };
  },
});

export const detectDuplicatesWorkflow = createWorkflow({
  id: "detect-duplicates",
  inputSchema: z.object({ vaultPath: z.string(), minSharedConcepts: z.number().optional() }),
  outputSchema: OutputSchema,
})
  .then(resolveVaultStep)
  .then(detectStep)
  .commit();
