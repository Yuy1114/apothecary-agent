import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { manualSync } from "../tools/manual-sync-core.js";

const OutputSchema = z.object({
  created: z.number(),
  modified: z.number(),
  deleted: z.number(),
  unchanged: z.number(),
  semanticRefreshed: z.boolean(),
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
  id: "manual-sync",
  inputSchema: z.object({ vaultPath: z.string() }),
  outputSchema: OutputSchema,
  execute: async ({ inputData }) => manualSync({ vaultPath: inputData.vaultPath }),
});

/**
 * Snapshot-diff reconciliation of the vault — the watcher's compensation path.
 * Recovers created/modified/deleted markdown the watcher missed and re-syncs the
 * index + change ledger + semantic layer.
 */
export const manualSyncWorkflow = createWorkflow({
  id: "manual-sync",
  inputSchema: z.object({ vaultPath: z.string() }),
  outputSchema: OutputSchema,
})
  .then(resolveVaultStep)
  .then(syncStep)
  .commit();
