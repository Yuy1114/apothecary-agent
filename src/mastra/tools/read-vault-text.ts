import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { readVaultText } from "../../vault/readText.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export const readVaultTextTool = createTool({
  id: "readVaultText",
  description:
    "Read the full UTF-8 content of a Markdown or .txt file inside the vault. Use it to understand inbox files before proposing where they belong.",
  inputSchema: z.object({
    filePath: z.string().describe("Vault-relative .md, .markdown, or .txt path"),
  }),
  outputSchema: z.object({
    filePath: z.string(),
    mediaType: z.enum(["markdown", "text"]),
    content: z.string(),
    lineCount: z.number(),
  }),
  execute: ({ filePath }) => readVaultText(VAULT_PATH, filePath),
});
