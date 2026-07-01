import type { VaultFile, VaultScan } from "../domain/vault.js";
import type { KnowledgeMapContext, MaintenanceReviewContext, ReviewerFileContext } from "./reviewerContext.js";

type BuildOptions = {
  maxFiles: number;
  minSizeBytes: number;
};

export function buildKnowledgeMapContext(scan: VaultScan, options: BuildOptions): KnowledgeMapContext {
  return buildBaseContext(scan, options);
}

export function buildMaintenanceReviewContext(scan: VaultScan, options: BuildOptions): MaintenanceReviewContext {
  return buildBaseContext(scan, options);
}

function buildBaseContext(scan: VaultScan, options: BuildOptions): KnowledgeMapContext {
  const files = scan.files
    .filter((file) => file.mediaType === "markdown")
    .filter((file) => file.sizeBytes >= options.minSizeBytes)
    .sort((a, b) => (b.wordCount ?? 0) - (a.wordCount ?? 0))
    .slice(0, options.maxFiles)
    .map(toReviewerFileContext);

  return {
    scanId: scan.id,
    vaultPath: scan.vaultPath,
    scopePath: scan.scopePath,
    scannedAt: scan.scannedAt,
    stats: scan.stats,
    files,
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
    headingTitles: file.headings?.map((heading) => heading.text) ?? [],
    excerpt: file.excerpt ? file.excerpt.slice(0, 500) : undefined,
  };
}
