import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { retrySemanticRecovery } from "../../application/semantic/semanticRecovery.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export const retrySemanticRecoveryTool = createTool({
  id: "retrySemanticRecovery",
  description:
    "Retry outstanding post-apply consistency work: pending changes with source 'proposal', left when a proposal's " +
    "semantic refresh failed after the file change already succeeded. Rebuilds the semantic layer for those files and " +
    "clears the work on success (on failure it stays pending for the next retry). Never modifies user notes; safe to run " +
    "repeatedly. Check listPendingChanges for 'proposal'-sourced items first.",
  inputSchema: z.object({}),
  outputSchema: z.object({ pending: z.number(), resolved: z.number() }),
  execute: async () => retrySemanticRecovery({ vaultPath: VAULT_PATH }),
});
