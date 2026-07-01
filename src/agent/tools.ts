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
      ignore: [".agent/**", ".apothecary/**", ".obsidian/**", ".trash/**", "**/.DS_Store", "**/node_modules/**", "**/.git/**"],
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
        .filter((f) => f.mediaType === "markdown")
        .map((f) => ({
          path: f.path,
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
    const absolutePath = `${vaultPath}/${filePath}`;
    const content = await fs.readFile(absolutePath, "utf8");
    const snapshot = parseMarkdownSnapshot(filePath, content);
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

export const writeReviewTool = createTool({
  id: "writeReview",
  description: "Persist maintenance review findings. Call this when your review is complete.",
  inputSchema: z.object({
    findings: z.array(z.object({
      type: z.enum(["stale_note", "long_context", "orphan_note", "duplicate_topic", "unassimilated_ai_output", "missing_index", "unclear_location", "superficial_note"]),
      severity: z.enum(["low", "medium", "high"]),
      filePaths: z.array(z.string()),
      observation: z.string(),
      whyItMatters: z.string(),
      suggestion: z.string(),
      confidence: z.number(),
    })),
    summary: z.string(),
  }),
  outputSchema: z.object({
    id: z.string(),
    findings: z.array(z.object({
      id: z.string(),
      type: z.string(),
      severity: z.string(),
      filePaths: z.array(z.string()),
      observation: z.string(),
      whyItMatters: z.string(),
      suggestion: z.string(),
      confidence: z.number(),
      relatedFiles: z.array(z.string()),
    })),
    summary: z.string(),
    generatedAt: z.string(),
  }),
  execute: async ({ findings, summary }) => {
    return {
      id: createId("review"),
      findings: findings.map((f) => ({ ...f, id: createId("finding"), relatedFiles: [] as string[] })),
      summary,
      generatedAt: new Date().toISOString(),
    };
  },
});
