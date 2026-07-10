import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { manualSync } from "../../application/sync/manualSync.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export const manualSyncTool = createTool({
  id: "manualSync",
  description:
    "Reconcile the vault against its last snapshot to recover changes the file watcher missed (e.g. edits made while " +
    "the app was down, or a bulk import). Diffs current markdown against the stored snapshot into created/modified/deleted, " +
    "updates the search index, records them as pending changes, refreshes the semantic layer, and re-saves the snapshot. " +
    "It reads user notes but never modifies them, so it is safe to run anytime. Unlike the live watcher it distinguishes " +
    "created from modified accurately.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    created: z.number(),
    modified: z.number(),
    deleted: z.number(),
    unchanged: z.number(),
    semanticRefreshed: z.boolean(),
  }),
  execute: async () => manualSync({ vaultPath: VAULT_PATH }),
});
