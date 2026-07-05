import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { readVaultText } from "./read-vault-text.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";
const EXCERPT_LIMIT = 4000;

export const readInboxFileTool = createTool({
  id: "readInboxFile",
  description:
    "Read a bounded text excerpt (~4000 chars) of ONE _inbox file (.md/.markdown/.txt) to disambiguate its placement " +
    "when the name alone is unclear (e.g. Untitled/temp/hash names). Only call this for the few entries you cannot " +
    "classify from the survey — do not read everything. Non-text files (images, pdf, video) are not readable here; " +
    "classify those from name/kind or record a low-confidence 'leave' decision.",
  inputSchema: z.object({
    filePath: z.string().describe("Vault-relative path under _inbox/, e.g. _inbox/foo.md"),
  }),
  outputSchema: z.object({
    filePath: z.string(),
    excerpt: z.string(),
    lineCount: z.number(),
    truncated: z.boolean(),
  }),
  execute: async ({ filePath }) => {
    if (!filePath.replaceAll("\\", "/").startsWith("_inbox/")) {
      throw new Error("not_an_inbox_file");
    }
    const { content, lineCount } = await readVaultText(VAULT_PATH, filePath);
    return {
      filePath,
      excerpt: content.slice(0, EXCERPT_LIMIT),
      lineCount,
      truncated: content.length > EXCERPT_LIMIT,
    };
  },
});
