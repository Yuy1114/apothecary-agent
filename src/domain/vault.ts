export type VaultLayer =
  | "inbox"
  | "raw"
  | "wiki"
  | "outputs"
  | "archive"
  | "agent"
  | "unknown";

export type VaultFileMediaType = "markdown" | "pdf" | "image" | "text" | "other";

export type DirectoryStat = {
  path: string;
  fileCount: number;
  markdownCount: number;
  totalBytes: number;
};

export type VaultStats = {
  totalFiles: number;
  markdownFiles: number;
  pdfFiles: number;
  imageFiles: number;
  otherFiles: number;
  totalBytes: number;
  topLevelDirectories: DirectoryStat[];
  recentlyChangedFiles: string[];
};

export type VaultFile = {
  path: string;
  absolutePath: string;
  extension: string;
  mediaType: VaultFileMediaType;
  title?: string;
  frontmatter?: Record<string, unknown>;
  sizeBytes: number;
  lineCount?: number;
  wordCount?: number;
  createdAt?: string;
  updatedAt: string;
  hash?: string;
  layer: VaultLayer;
};

export type VaultScan = {
  id: string;
  vaultPath: string;
  scopePath?: string;
  scannedAt: string;
  files: VaultFile[];
  stats: VaultStats;
};

export type MarkdownHeading = {
  level: number;
  text: string;
  line?: number;
};

export type MarkdownSnapshot = {
  filePath: string;
  title?: string;
  headings: MarkdownHeading[];
  excerpt: string;
  frontmatter?: Record<string, unknown>;
  lineCount: number;
  wordCount: number;
};
