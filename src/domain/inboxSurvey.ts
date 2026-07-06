import path from "node:path";
import { z } from "zod";

/**
 * A cheap, content-free view of `_inbox` for cold-start triage. The organizer
 * subagent reads this first — top-level entries with a coarse `kind` and, for
 * directories, a folded summary (file count + dominant extensions + a name
 * sample) instead of every child. No file contents are read here; the organizer
 * deepens only the entries whose placement is unclear from the name.
 */

export const InboxEntryKindSchema = z.enum([
  "markdown",
  "pdf",
  "text",
  "image",
  "video",
  "audio",
  "directory",
  "package",
  "junk",
  "other",
]);
export type InboxEntryKind = z.infer<typeof InboxEntryKindSchema>;

export const InboxEntrySchema = z.object({
  /** Basename inside `_inbox`. */
  name: z.string(),
  /** Vault-relative path, e.g. `_inbox/foo.md`. */
  path: z.string(),
  kind: InboxEntryKindSchema,
  /** File size in bytes (files only). */
  sizeBytes: z.number().int().nonnegative().optional(),
  /** Lowercased extension incl. dot (files only), e.g. `.md`. */
  ext: z.string().optional(),
  // ── Folded directory summary (directories only) ──
  fileCount: z.number().int().nonnegative().optional(),
  topExtensions: z.array(z.object({ ext: z.string(), count: z.number().int().nonnegative() })).optional(),
  sample: z.array(z.string()).optional(),
  /** The directory walk hit its cap; `fileCount` is a floor. */
  truncated: z.boolean().optional(),
});
export type InboxEntry = z.infer<typeof InboxEntrySchema>;

export const InboxSurveySchema = z.object({
  /** Always `_inbox`. */
  root: z.string(),
  scannedAt: z.string(),
  /** All top-level entries including junk. */
  total: z.number().int().nonnegative(),
  /** Count of OS/tooling junk (excluded from `entries`). */
  junk: z.number().int().nonnegative(),
  /** A few example junk names so the organizer can batch-dispose by rule. */
  junkSample: z.array(z.string()),
  /** Non-junk top-level entries, sorted by path. */
  entries: z.array(InboxEntrySchema),
});
export type InboxSurvey = z.infer<typeof InboxSurveySchema>;

// ── Pure classifiers ──

const JUNK_NAMES = new Set([".DS_Store", ".localized", "Thumbs.db", "desktop.ini", "Icon\r"]);

/** OS/tooling noise that is never user content (incl. `__`-flattened `.DS_Store`). */
export function isJunkName(name: string): boolean {
  if (JUNK_NAMES.has(name)) return true;
  if (name.startsWith("._")) return true; // AppleDouble sidecar
  if (name === ".DS_Store" || name.endsWith("__.DS_Store") || name.endsWith(".DS_Store")) return true;
  return false;
}

const PACKAGE_EXTS = new Set([
  ".photoslibrary",
  ".app",
  ".bundle",
  ".framework",
  ".rtfd",
  ".key",
  ".numbers",
  ".pages",
  ".fcpbundle",
  ".imovielibrary",
  ".tvlibrary",
  ".aplibrary",
]);

/** macOS/iWork bundle dirs — opaque units, never descended into. */
export function isPackageDir(name: string): boolean {
  return PACKAGE_EXTS.has(path.extname(name).toLowerCase());
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".heic", ".heif", ".bmp", ".tiff", ".tif"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".flv", ".wmv"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".flac", ".aac", ".ogg", ".opus"]);

/** Coarse content-free classification of a top-level file by name/extension. */
export function classifyFileKind(name: string): InboxEntryKind {
  if (isJunkName(name)) return "junk";
  const ext = path.extname(name).toLowerCase();
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".pdf") return "pdf";
  if (ext === ".txt" || ext === ".rtf" || ext === ".text") return "text";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return "other";
}

/** Top-N extension histogram from a list of child file names. */
export function summarizeExtensions(names: string[], topN = 5): { ext: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const name of names) {
    const ext = path.extname(name).toLowerCase() || "«none»";
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([ext, count]) => ({ ext, count }));
}
