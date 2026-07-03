import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseMarkdownSnapshot } from "../../vault/markdown.js";
import { safeVaultPath } from "../../safety/pathSafety.js";

export async function readMarkdown(vaultPath: string, filePath: string) {
  const absolutePath = safeVaultPath(vaultPath, filePath);
  const extension = path.extname(filePath).toLowerCase();
  if (!absolutePath) throw new Error("unsafe_path");
  if (extension !== ".md" && extension !== ".markdown") throw new Error("unsupported_markdown_type");
  const content = await fs.readFile(absolutePath, "utf8");
  return parseMarkdownSnapshot(filePath, content);
}

export const readMarkdownTool = createTool({
  id: "readMarkdown",
  description: "Read the full content of a markdown file from the vault. Use this to inspect files that seem interesting after a scan.",
  inputSchema: z.object({
    filePath: z.string().describe("Relative path inside the vault, e.g. 'notes/programming/Java/README.md'"),
  }),
  outputSchema: z.object({
    filePath: z.string(),
    title: z.string().optional(),
    headings: z.array(z.object({ level: z.number(), text: z.string() })),
    excerpt: z.string(),
    lineCount: z.number(),
    wordCount: z.number(),
  }),
  execute: async ({ filePath }) => {
    const vaultPath = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";
    const snapshot = await readMarkdown(vaultPath, filePath);
    return {
      filePath,
      title: snapshot.title,
      headings: snapshot.headings,
      excerpt: snapshot.excerpt.slice(0, 800),
      lineCount: snapshot.lineCount,
      wordCount: snapshot.wordCount,
    };
  },
});
