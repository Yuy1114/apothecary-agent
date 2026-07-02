import path from "node:path";
import { promises as fs } from "node:fs";
import fg from "fast-glob";
import type { DirectoryStat, VaultFile, VaultFileMediaType, VaultScan, VaultStats } from "../domain/vault.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";
import { classifyLayer } from "./classifyLayer.js";
import { hashFile } from "./hash.js";
import { parseMarkdownSnapshot } from "./markdown.js";
import { relativeVaultPath, toPosixPath } from "./paths.js";

export type ScanVaultOptions = {
  vaultPath: string;
  scopePath?: string;
  includeHash?: boolean;
  ignore?: string[];
  recentFilesLimit?: number;
};

// Always excluded, regardless of caller-provided `ignore`: OS/VCS/tooling junk
// that is never vault content (e.g. macOS .DS_Store).
const ALWAYS_IGNORE = ["**/.DS_Store", "**/._*", "**/node_modules/**", "**/.git/**"];
const DEFAULT_IGNORE = [".agent/**"];

export async function scanVault(options: ScanVaultOptions): Promise<VaultScan> {
  const vaultPath = path.resolve(options.vaultPath);
  const scopeRoot = options.scopePath ? path.join(vaultPath, options.scopePath) : vaultPath;
  const entries = await fg(["**/*"], {
    cwd: scopeRoot,
    dot: true,
    onlyFiles: true,
    ignore: [...ALWAYS_IGNORE, ...(options.ignore ?? DEFAULT_IGNORE)],
    absolute: true,
  });

  const files = await Promise.all(
    entries.map((absolutePath) => buildVaultFile(vaultPath, absolutePath, options.includeHash ?? true)),
  );

  return {
    id: createId("scan"),
    vaultPath,
    scopePath: options.scopePath,
    scannedAt: nowIso(),
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    stats: buildStats(files, options.recentFilesLimit ?? 10),
  };
}

async function buildVaultFile(vaultPath: string, absolutePath: string, includeHash: boolean): Promise<VaultFile> {
  const stat = await fs.stat(absolutePath);
  const relativePath = relativeVaultPath(vaultPath, absolutePath);
  const extension = path.extname(absolutePath).toLowerCase();
  const mediaType = classifyMediaType(extension);
  const base: VaultFile = {
    path: relativePath,
    absolutePath,
    extension,
    mediaType,
    sizeBytes: stat.size,
    createdAt: stat.birthtime.toISOString(),
    updatedAt: stat.mtime.toISOString(),
    layer: classifyLayer(relativePath),
  };

  if (mediaType === "markdown") {
    const content = await fs.readFile(absolutePath, "utf8");
    const snapshot = parseMarkdownSnapshot(relativePath, content);
    base.title = snapshot.title;
    base.frontmatter = snapshot.frontmatter;
    base.headings = snapshot.headings;
    base.excerpt = snapshot.excerpt;
    base.lineCount = snapshot.lineCount;
    base.wordCount = snapshot.wordCount;
  }

  if (includeHash) {
    base.hash = await hashFile(absolutePath);
  }

  return base;
}

function classifyMediaType(extension: string): VaultFileMediaType {
  if (extension === ".md" || extension === ".markdown") return "markdown";
  if (extension === ".pdf") return "pdf";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(extension)) return "image";
  if ([".txt", ".csv", ".json", ".yaml", ".yml"].includes(extension)) return "text";
  return "other";
}

function buildStats(files: VaultFile[], recentFilesLimit: number): VaultStats {
  const topLevelMap = new Map<string, DirectoryStat>();

  for (const file of files) {
    const topLevel = toPosixPath(file.path).split("/")[0] || ".";
    const current = topLevelMap.get(topLevel) ?? {
      path: topLevel,
      fileCount: 0,
      markdownCount: 0,
      totalBytes: 0,
    };

    current.fileCount += 1;
    current.markdownCount += file.mediaType === "markdown" ? 1 : 0;
    current.totalBytes += file.sizeBytes;
    topLevelMap.set(topLevel, current);
  }

  const recentlyChangedFiles = [...files]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, recentFilesLimit)
    .map((file) => file.path);

  return {
    totalFiles: files.length,
    markdownFiles: files.filter((file) => file.mediaType === "markdown").length,
    pdfFiles: files.filter((file) => file.mediaType === "pdf").length,
    imageFiles: files.filter((file) => file.mediaType === "image").length,
    otherFiles: files.filter((file) => !["markdown", "pdf", "image"].includes(file.mediaType)).length,
    totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    topLevelDirectories: [...topLevelMap.values()].sort((a, b) => b.fileCount - a.fileCount),
    recentlyChangedFiles,
  };
}
