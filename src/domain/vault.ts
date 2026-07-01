import { z } from "zod";

export const VaultLayerSchema = z.enum(["inbox", "raw", "wiki", "outputs", "archive", "agent", "unknown"]);
export type VaultLayer = z.infer<typeof VaultLayerSchema>;

export const VaultFileMediaTypeSchema = z.enum(["markdown", "pdf", "image", "text", "other"]);
export type VaultFileMediaType = z.infer<typeof VaultFileMediaTypeSchema>;

export const DirectoryStatSchema = z.object({
  path: z.string().min(1),
  fileCount: z.number().int().nonnegative(),
  markdownCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
});
export type DirectoryStat = z.infer<typeof DirectoryStatSchema>;

export const VaultStatsSchema = z.object({
  totalFiles: z.number().int().nonnegative(),
  markdownFiles: z.number().int().nonnegative(),
  pdfFiles: z.number().int().nonnegative(),
  imageFiles: z.number().int().nonnegative(),
  otherFiles: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  topLevelDirectories: z.array(DirectoryStatSchema),
  recentlyChangedFiles: z.array(z.string()),
});
export type VaultStats = z.infer<typeof VaultStatsSchema>;

export const VaultFileSchema = z.object({
  path: z.string().min(1),
  absolutePath: z.string().min(1),
  extension: z.string(),
  mediaType: VaultFileMediaTypeSchema,
  title: z.string().optional(),
  frontmatter: z.record(z.unknown()).optional(),
  sizeBytes: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative().optional(),
  wordCount: z.number().int().nonnegative().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().min(1),
  hash: z.string().optional(),
  layer: VaultLayerSchema,
});
export type VaultFile = z.infer<typeof VaultFileSchema>;

export const VaultScanSchema = z.object({
  id: z.string().min(1),
  vaultPath: z.string().min(1),
  scopePath: z.string().optional(),
  scannedAt: z.string().min(1),
  files: z.array(VaultFileSchema),
  stats: VaultStatsSchema,
});
export type VaultScan = z.infer<typeof VaultScanSchema>;

export const MarkdownHeadingSchema = z.object({
  level: z.number().int().min(1).max(6),
  text: z.string().min(1),
  line: z.number().int().positive().optional(),
});
export type MarkdownHeading = z.infer<typeof MarkdownHeadingSchema>;

export const MarkdownSnapshotSchema = z.object({
  filePath: z.string().min(1),
  title: z.string().optional(),
  headings: z.array(MarkdownHeadingSchema),
  excerpt: z.string(),
  frontmatter: z.record(z.unknown()).optional(),
  lineCount: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
});
export type MarkdownSnapshot = z.infer<typeof MarkdownSnapshotSchema>;
