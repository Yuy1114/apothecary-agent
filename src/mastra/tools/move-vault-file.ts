import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export const moveVaultFileTool = createTool({
  id: "moveVaultFile",
  description:
    "Move a file from one location to another within the vault. Creates target directories as needed. Use this to reorganize files after an organize analysis.",
  inputSchema: z.object({
    from: z.string().describe("Current relative path of the file in the vault"),
    to: z.string().describe("Target relative path in the vault"),
  }),
  outputSchema: z.object({
    moved: z.boolean(),
    from: z.string(),
    to: z.string(),
  }),
  execute: async ({ from, to }) => {
    const fromAbs = path.join(VAULT_PATH, from);
    const toAbs = path.join(VAULT_PATH, to);

    await fs.mkdir(path.dirname(toAbs), { recursive: true });

    try {
      await fs.access(fromAbs);
    } catch {
      return { moved: false, from, to };
    }

    await fs.rename(fromAbs, toAbs);

    const sourceDir = path.dirname(fromAbs);
    try {
      const remaining = await fs.readdir(sourceDir);
      if (remaining.length === 0 || (remaining.length === 1 && remaining[0] === ".DS_Store")) {
        await fs.rm(sourceDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }

    return { moved: true, from, to };
  },
});
