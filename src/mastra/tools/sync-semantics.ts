import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { syncSemanticsFromChanges } from "../../application/semantic/syncSemanticsFromChanges.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export const syncSemanticsTool = createTool({
  id: "syncSemantics",
  description:
    "Refresh the agent's semantic layer (file summaries + topic/concept graph) for files that recently changed. " +
    "Reads the pending change queue and re-summarizes only new/edited notes and prunes deleted ones — it does NOT " +
    "modify any user note and does NOT clear the pending-change triage queue. Run it after notes have changed so " +
    "later RAG, duplicate detection and profile work see up-to-date understanding. Safe to run repeatedly; unchanged " +
    "files are skipped.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    scanned: z.number(),
    refreshed: z.number(),
    pruned: z.number(),
    skipped: z.number(),
    failed: z.number(),
    topics: z.number(),
    concepts: z.number(),
  }),
  execute: async () => syncSemanticsFromChanges({ vaultPath: VAULT_PATH }),
});
