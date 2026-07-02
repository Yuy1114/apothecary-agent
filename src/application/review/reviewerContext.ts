import type { VaultFileMediaType, VaultLayer, VaultStats } from "../../domain/vault.js";

export type ReviewerFileContext = {
  path: string;
  title?: string;
  mediaType: VaultFileMediaType;
  layer: VaultLayer;
  sizeBytes: number;
  lineCount?: number;
  wordCount?: number;
  updatedAt: string;
  frontmatterKeys: string[];
  headingTitles: string[];
  excerpt?: string;
};

export type BaseReviewerContext = {
  scanId: string;
  vaultPath: string;
  scopePath?: string;
  scannedAt: string;
  stats: VaultStats;
  files: ReviewerFileContext[];
};

export type KnowledgeMapContext = BaseReviewerContext;

export type MaintenanceReviewContext = BaseReviewerContext;
