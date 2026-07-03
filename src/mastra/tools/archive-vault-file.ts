import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { requiresHumanApproval } from "./permissions.js";
import { archiveVaultFileCore } from "./archive-vault-file-core.js";

export const archiveVaultFileTool = createTool({
  id: "archiveVaultFile",
  description:
    "Archive a vault note instead of deleting it: moves it under `archive/` (preserving its path), removes it from " +
    "the search index, and records the reason in the operation ledger. The file is NOT deleted — it stays on disk but " +
    "leaves the active knowledge picture (no longer scanned, summarized, or surfaced in RAG). Use it to retire " +
    "low-value or superseded notes, or to archive the absorbed copy after merging duplicates. Moving user files " +
    "requires human approval. Refuses to overwrite and never touches already-archived files.",
  requireApproval: requiresHumanApproval,
  inputSchema: z.object({
    from: z.string().describe("Current relative path of the note to archive"),
    reason: z
      .string()
      .optional()
      .describe("Why it is being archived (e.g. 'merged into notes/redis.md', 'superseded')"),
  }),
  outputSchema: z.object({
    archived: z.boolean(),
    from: z.string(),
    to: z.string().optional(),
    reindexed: z.boolean(),
    reason: z.string().optional(),
  }),
  execute: async ({ from, reason }) => archiveVaultFileCore(from, { reason }),
});
