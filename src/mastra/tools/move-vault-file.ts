import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { requiresHumanApproval } from "./permissions.js";
import { moveVaultFileCore } from "./move-vault-file-core.js";

export const moveVaultFileTool = createTool({
  id: "moveVaultFile",
  description:
    "Move a file from one location to another within the vault. Creates target directories as needed, and keeps the search index in sync (removes the old path, indexes the new one) for markdown files. Refuses to overwrite an existing target. Use this to reorganize files after an organize analysis.",
  requireApproval: requiresHumanApproval,
  inputSchema: z.object({
    from: z.string().describe("Current relative path of the file in the vault"),
    to: z.string().describe("Target relative path in the vault"),
  }),
  outputSchema: z.object({
    moved: z.boolean(),
    from: z.string(),
    to: z.string(),
    reindexed: z.boolean(),
    reason: z.string().optional(),
  }),
  execute: async ({ from, to }) => {
    const result = await moveVaultFileCore(from, to);
    return { moved: result.moved, from, to, reindexed: result.reindexed, reason: result.reason };
  },
});
