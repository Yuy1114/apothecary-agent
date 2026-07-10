import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { VaultScanSchema } from "../../domain/vault.js";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { scanVault } from "../../vault/scanner.js";
import { VAULT_IGNORE_GLOBS } from "../../domain/vaultPolicy.js";
import {
  loadSummaries,
  saveSummaries,
  saveGraph,
  needsRefresh,
  upsertSummary,
  pruneMissing,
} from "../../vault/semanticStore.js";
import { buildSemanticGraph } from "../../domain/semanticGraph.js";
import { refreshRelations } from "../../application/semantic/refreshRelations.js";
import { generateFileSummary } from "../../application/semantic/generateFileSummary.js";
import { mapWithConcurrency, withTimeout } from "../../utils/concurrency.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";

const OutputSchema = z.object({
  refreshed: z.number(),
  skipped: z.number(),
  pruned: z.number(),
  failed: z.number(),
  topics: z.number(),
  concepts: z.number(),
});

const CONCURRENCY = Number(process.env.APOTHECARY_SEMANTIC_CONCURRENCY ?? 8);
const PER_FILE_TIMEOUT_MS = Number(process.env.APOTHECARY_SEMANTIC_TIMEOUT_MS ?? 90_000);

const resolveVaultStep = createStep({
  id: "resolve-vault",
  inputSchema: z.object({ vaultPath: z.string(), scopePath: z.string().optional() }),
  outputSchema: z.object({ vaultPath: z.string(), scopePath: z.string().optional() }),
  execute: async ({ inputData }) => ({
    vaultPath: await resolveExistingDirectory(inputData.vaultPath),
    scopePath: inputData.scopePath,
  }),
});

const scanStep = createStep({
  id: "scan",
  inputSchema: z.object({ vaultPath: z.string(), scopePath: z.string().optional() }),
  outputSchema: z.object({ vaultPath: z.string(), scan: VaultScanSchema }),
  execute: async ({ inputData }) => {
    const scan = VaultScanSchema.parse(
      await scanVault({
        vaultPath: inputData.vaultPath,
        scopePath: inputData.scopePath,
        includeHash: true,
        ignore: VAULT_IGNORE_GLOBS,
      }),
    );
    return { vaultPath: inputData.vaultPath, scan };
  },
});

const refreshStep = createStep({
  id: "refresh-summaries",
  inputSchema: z.object({ vaultPath: z.string(), scan: VaultScanSchema }),
  outputSchema: OutputSchema,
  execute: async ({ inputData }) => {
    const { vaultPath, scan } = inputData;
    // Vault content is scanned from `vaultPath`; the semantic layer it produces
    // is persisted to the global agent home, not inside the vault.
    const home = apothecaryHome();
    const markdown = scan.files.filter((file) => file.mediaType === "markdown");

    let summaries = await loadSummaries(home);

    const toProcess = markdown.filter((file) => needsRefresh(summaries, file.path, file.hash ?? ""));
    const skipped = markdown.length - toProcess.length;

    // Summaries are independent per file; generate them in parallel with a
    // bounded worker pool so a full vault pass doesn't run 148 LLM calls serially.
    const outcomes = await mapWithConcurrency(toProcess, CONCURRENCY, async (file) => {
      try {
        const content = await fs.readFile(file.absolutePath, "utf8");
        return await withTimeout(
          generateFileSummary({
            path: file.path,
            title: file.title ?? file.path,
            content,
            contentHash: file.hash ?? "",
          }),
          PER_FILE_TIMEOUT_MS,
        );
      } catch {
        return null;
      }
    });

    let refreshed = 0;
    let failed = 0;
    for (const outcome of outcomes) {
      if (outcome) {
        summaries = upsertSummary(summaries, outcome);
        refreshed += 1;
      } else {
        failed += 1;
      }
    }

    const pruneResult = pruneMissing(summaries, markdown.map((file) => file.path));
    await saveSummaries(home, pruneResult.summaries);

    // Rebuild the derived semantic graph from the final summaries (deterministic, cheap).
    const graph = buildSemanticGraph(pruneResult.summaries);
    await saveGraph(home, graph);
    await refreshRelations(home, graph);

    return {
      refreshed,
      skipped,
      pruned: pruneResult.pruned,
      failed,
      topics: graph.topics.length,
      concepts: graph.concepts.length,
    };
  },
});

export const refreshSemanticsWorkflow = createWorkflow({
  id: "refresh-semantics",
  inputSchema: z.object({ vaultPath: z.string(), scopePath: z.string().optional() }),
  outputSchema: OutputSchema,
})
  .then(resolveVaultStep)
  .then(scanStep)
  .then(refreshStep)
  .commit();
