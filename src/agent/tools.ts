import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { scanVault } from "../vault/scanner.js";
import { parseMarkdownSnapshot } from "../vault/markdown.js";
import { promises as fs } from "node:fs";
import { createId } from "../utils/ids.js";
import { VaultScanSchema } from "../domain/vault.js";

export const scanVaultTool = createTool({
  id: "scanVault",
  description:
    "Scan the vault directory and return metadata for all files. Use this first to understand what content exists. Returns file paths, types, sizes, line counts, headings, and excerpts.",
  inputSchema: z.object({
    scopePath: z.string().optional().describe("Limit scan to a subdirectory, e.g. 'projects/apothecary-agent'"),
  }),
  execute: async ({ scopePath }) => {
    const result = await scanVault({
      vaultPath: process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault",
      scopePath,
      includeHash: false,
      ignore: [".agent/**", ".apothecary/**", ".obsidian/**", ".trash/**", "**/.DS_Store", "**/node_modules/**", "**/.git/**"],
    });
    return VaultScanSchema.parse(result);
  },
});

export const readMarkdownTool = createTool({
  id: "readMarkdown",
  description:
    "Read the full content of a markdown file from the vault. Use this to inspect files that seem interesting after a scan. Returns headings, excerpt, and line/word counts.",
  inputSchema: z.object({
    filePath: z.string().describe("Relative path to the markdown file inside the vault, e.g. 'projects/foo/README.md'"),
  }),
  execute: async ({ filePath }) => {
    const vaultPath = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";
    const absolutePath = `${vaultPath}/${filePath}`;
    const content = await fs.readFile(absolutePath, "utf8");
    const snapshot = parseMarkdownSnapshot(filePath, content);
    return {
      ...snapshot,
      excerpt: snapshot.excerpt.slice(0, 500),
      frontmatter: undefined,
    };
  },
});

export const writeReviewTool = createTool({
  id: "writeReview",
  description:
    "Write the maintenance review findings to the agent workspace. Call this when you have completed your review and want to persist the findings.",
  inputSchema: z.object({
    findings: z
      .array(
        z.object({
          type: z.enum([
            "stale_note",
            "long_context",
            "orphan_note",
            "duplicate_topic",
            "unassimilated_ai_output",
            "missing_index",
            "unclear_location",
            "superficial_note",
          ]),
          severity: z.enum(["low", "medium", "high"]),
          filePaths: z.array(z.string()),
          observation: z.string(),
          whyItMatters: z.string(),
          suggestion: z.string(),
          confidence: z.number().min(0).max(1),
        }),
      )
      .describe("Array of maintenance review findings"),
    summary: z.string().describe("One or two sentence overall summary of the review"),
  }),
  execute: async ({ findings, summary }) => {
    const hydratedFindings = findings.map((finding) => ({
      ...finding,
      id: createId("finding"),
      relatedFiles: [] as string[],
    }));

    return {
      findings: hydratedFindings,
      summary,
      id: createId("review"),
      generatedAt: new Date().toISOString(),
    };
  },
});
