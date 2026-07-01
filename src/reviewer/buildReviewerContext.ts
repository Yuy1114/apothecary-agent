import type { VaultFile, VaultScan } from "../domain/vault.js";
import type { KnowledgeMapContext, MaintenanceReviewContext, ReviewerFileContext } from "./reviewerContext.js";

export function buildKnowledgeMapContext(scan: VaultScan): KnowledgeMapContext {
  return buildBaseContext(scan);
}

export function buildMaintenanceReviewContext(scan: VaultScan): MaintenanceReviewContext {
  return buildBaseContext(scan);
}

function buildBaseContext(scan: VaultScan): KnowledgeMapContext {
  return {
    scanId: scan.id,
    vaultPath: scan.vaultPath,
    scopePath: scan.scopePath,
    scannedAt: scan.scannedAt,
    stats: scan.stats,
    files: scan.files.map(toReviewerFileContext),
  };
}

function toReviewerFileContext(file: VaultFile): ReviewerFileContext {
  return {
    path: file.path,
    title: file.title,
    mediaType: file.mediaType,
    layer: file.layer,
    sizeBytes: file.sizeBytes,
    lineCount: file.lineCount,
    wordCount: file.wordCount,
    updatedAt: file.updatedAt,
    frontmatterKeys: Object.keys(file.frontmatter ?? {}).sort(),
  };
}
