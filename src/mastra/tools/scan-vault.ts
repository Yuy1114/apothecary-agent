import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { scanVault } from "../../vault/scanner.js";
import { VAULT_IGNORE_GLOBS } from "../../domain/vaultPolicy.js";
import { VaultScanSchema } from "../../domain/vault.js";

export const scanVaultTool = createTool({
  id: "scanVault",
  description:
    "Scan the vault directory and return metadata for all files. Use this first to understand what content exists.",
  inputSchema: z.object({
    scopePath: z.string().optional().describe("Limit scan to a subdirectory"),
  }),
  outputSchema: z.object({
    id: z.string(),
    vaultPath: z.string(),
    scannedAt: z.string(),
    stats: z.object({
      totalFiles: z.number(),
      markdownFiles: z.number(),
      pdfFiles: z.number(),
      imageFiles: z.number(),
      otherFiles: z.number(),
    }),
    files: z.array(z.object({
      path: z.string(),
      mediaType: z.enum(["markdown", "text"]),
      title: z.string().optional(),
      headingTitles: z.array(z.string()),
      excerpt: z.string().optional(),
      layer: z.string(),
      lineCount: z.number().optional(),
      wordCount: z.number().optional(),
    })),
  }),
  execute: async ({ scopePath }) => {
    const result = await scanVault({
      vaultPath: process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault",
      scopePath,
      includeHash: false,
      ignore: VAULT_IGNORE_GLOBS,
    });
    const parsed = VaultScanSchema.parse(result);
    return {
      id: parsed.id,
      vaultPath: parsed.vaultPath,
      scannedAt: parsed.scannedAt,
      stats: {
        totalFiles: parsed.stats.totalFiles,
        markdownFiles: parsed.stats.markdownFiles,
        pdfFiles: parsed.stats.pdfFiles,
        imageFiles: parsed.stats.imageFiles,
        otherFiles: parsed.stats.otherFiles,
      },
      files: parsed.files
        .filter((f) => f.mediaType === "markdown" || f.extension === ".txt")
        .map((f) => ({
          path: f.path,
          mediaType: f.mediaType as "markdown" | "text",
          title: f.title,
          headingTitles: f.headings?.map((h) => h.text) ?? [],
          excerpt: f.excerpt?.slice(0, 300),
          layer: f.layer,
          lineCount: f.lineCount,
          wordCount: f.wordCount,
        })),
    };
  },
});
