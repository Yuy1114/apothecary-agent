import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { syncSemanticsFromChanges } from "../../application/semantic/syncSemanticsFromChanges.js";

const OutputSchema = z.object({
  scanned: z.number(),
  refreshed: z.number(),
  pruned: z.number(),
  skipped: z.number(),
  failed: z.number(),
  topics: z.number(),
  concepts: z.number(),
});

const resolveVaultStep = createStep({
  id: "resolve-vault",
  inputSchema: z.object({ vaultPath: z.string() }),
  outputSchema: z.object({ vaultPath: z.string() }),
  execute: async ({ inputData }) => ({
    vaultPath: await resolveExistingDirectory(inputData.vaultPath),
  }),
});

const syncStep = createStep({
  id: "sync-semantics-from-changes",
  inputSchema: z.object({ vaultPath: z.string() }),
  outputSchema: OutputSchema,
  execute: async ({ inputData }) => syncSemanticsFromChanges({ vaultPath: inputData.vaultPath }),
});

/**
 * Change-driven semantic refresh: reads the pending change queue and refreshes
 * summaries + graph for only the affected files. The lightweight, incremental
 * counterpart to the full-vault refresh-semantics workflow.
 */
export const syncSemanticsWorkflow = createWorkflow({
  id: "sync-semantics",
  inputSchema: z.object({ vaultPath: z.string() }),
  outputSchema: OutputSchema,
})
  .then(resolveVaultStep)
  .then(syncStep)
  .commit();
