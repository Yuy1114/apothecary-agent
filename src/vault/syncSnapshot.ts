import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getAgentArtifacts } from "../artifacts/agentArtifacts.js";
import { apothecaryHome } from "../config/apothecaryHome.js";
import { hashFile } from "./hash.js";
import { isArchivedPath } from "./archive.js";
import { clearSelfWrite } from "./selfWriteGuard.js";
import { nowIso } from "../utils/time.js";

/**
 * A content snapshot of the vault's markdown files, taken by manual sync so a
 * later sync can diff against it and recover changes the watcher missed. Keyed
 * by relative path → content hash.
 */
export const SyncSnapshotEntrySchema = z.object({ hash: z.string() });
export type SyncSnapshotEntry = z.infer<typeof SyncSnapshotEntrySchema>;

export const SyncSnapshotSchema = z.object({
  generatedAt: z.string(),
  files: z.record(z.string(), SyncSnapshotEntrySchema),
});
export type SyncSnapshot = z.infer<typeof SyncSnapshotSchema>;

export type SnapshotFiles = Record<string, SyncSnapshotEntry>;

export type SnapshotDiff = {
  created: string[];
  modified: string[];
  deleted: string[];
  unchanged: string[];
};

function snapshotPath(vaultPath: string): string {
  return path.join(getAgentArtifacts(vaultPath).rootPath, "sync", "snapshot.json");
}

const EMPTY_SNAPSHOT: SyncSnapshot = { generatedAt: "", files: {} };

export async function loadSnapshot(vaultPath: string): Promise<SyncSnapshot> {
  try {
    return SyncSnapshotSchema.parse(JSON.parse(await fs.readFile(snapshotPath(vaultPath), "utf8")));
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

export async function saveSnapshot(vaultPath: string, snapshot: SyncSnapshot): Promise<void> {
  const filePath = snapshotPath(vaultPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
}

/**
 * Compare a stored snapshot against the current file set (both path→hash) and
 * classify every path. Pure and deterministic — the heart of manual sync.
 *
 * - `created` — in current, absent from the snapshot.
 * - `modified` — in both, hash differs.
 * - `deleted` — in the snapshot, absent from current.
 * - `unchanged` — in both, same hash.
 */
// Serialize every load→modify→save so concurrent writers (a system op's
// commit and the watcher's own update) never clobber each other's changes.
let snapshotLock: Promise<unknown> = Promise.resolve();
function withSnapshotLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = snapshotLock.then(fn, fn);
  snapshotLock = run.catch(() => undefined);
  return run;
}

/** Normalise to the vault-relative POSIX form the baseline is keyed by. */
function toRelKey(relativePath: string): string {
  return relativePath.split(/[\\/]/).join("/").replace(/^\.\//, "");
}

/**
 * The baseline mirrors manual sync's scan: non-ignored markdown only. Committing
 * anything else (a non-md file, an archived/dotfile path) would desync it — a
 * later manual-sync scan wouldn't see that path and would report it as deleted.
 */
function isBaselinePath(relPath: string): boolean {
  return relPath.endsWith(".md") && !relPath.startsWith(".") && !isArchivedPath(relPath);
}

/**
 * Commit the current on-disk state of the given vault-relative paths into the
 * sync baseline: existing files get their hash upserted, missing files (moved or
 * archived away) are dropped. This is how a system write records "I already
 * accounted for these", so neither the watcher nor a later manual sync re-flags
 * them as external edits. Batched (one load→save for all paths) and serialized
 * against other snapshot writers. Non-baseline paths (non-md, archived, dotfiles)
 * are ignored to keep the baseline in step with what manual sync scans.
 */
export async function commitSelfWrite(
  vaultPath: string,
  relPaths: Iterable<string>,
  home: string = apothecaryHome(),
): Promise<void> {
  const normalized = [...new Set([...relPaths].map(toRelKey))].filter(Boolean);
  if (normalized.length === 0) return;
  const baselinePaths = normalized.filter(isBaselinePath);
  if (baselinePaths.length > 0) {
    await withSnapshotLock(async () => {
      const snapshot = await loadSnapshot(home);
      const files: SnapshotFiles = { ...snapshot.files };
      for (const rel of baselinePaths) {
        try {
          files[rel] = { hash: await hashFile(path.join(vaultPath, rel)) };
        } catch {
          delete files[rel]; // gone (moved/archived away) → drop from baseline
        }
      }
      await saveSnapshot(home, { generatedAt: nowIso(), files });
    });
  }
  // The write is now reflected in the baseline; release the pending marks so a
  // later external edit to any of these paths is detected immediately.
  clearSelfWrite(normalized);
}

export function diffSnapshot(previous: SnapshotFiles, current: SnapshotFiles): SnapshotDiff {
  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const unchanged: string[] = [];

  for (const [p, entry] of Object.entries(current)) {
    const prior = previous[p];
    if (!prior) created.push(p);
    else if (prior.hash !== entry.hash) modified.push(p);
    else unchanged.push(p);
  }
  for (const p of Object.keys(previous)) {
    if (!current[p]) deleted.push(p);
  }

  return {
    created: created.sort(),
    modified: modified.sort(),
    deleted: deleted.sort(),
    unchanged: unchanged.sort(),
  };
}
