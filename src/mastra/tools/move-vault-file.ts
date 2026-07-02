import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { requiresHumanApproval } from "./permissions.js";
import { reindexFile, removeFromIndex } from "./rag.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export const moveVaultFileTool = createTool({
  id: "moveVaultFile",
  description:
    "Move a file from one location to another within the vault. Creates target directories as needed, and keeps the search index in sync (removes the old path, indexes the new one) for markdown files. Use this to reorganize files after an organize analysis.",
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
  }),
  execute: async ({ from, to }) => {
    const fromAbs = path.join(VAULT_PATH, from);
    const toAbs = path.join(VAULT_PATH, to);

    await fs.mkdir(path.dirname(toAbs), { recursive: true });

    try {
      await fs.access(fromAbs);
    } catch {
      return { moved: false, from, to, reindexed: false };
    }

    await fs.rename(fromAbs, toAbs);

    // Deliberately do NOT delete the (now possibly empty) source directory:
    // structural folders like inbox/ must persist. Empty directories are
    // harmless and cleaning them up is an explicit, separate concern.

    // Keep the vector index in sync: drop the old source, index the new one.
    // Only markdown files participate in the index.
    let reindexed = false;
    if (from.endsWith(".md")) {
      await removeFromIndex(from);
      reindexed = true;
    }
    if (to.endsWith(".md")) {
      await reindexFile(to);
      reindexed = true;
    }

    return { moved: true, from, to, reindexed };
  },
});
