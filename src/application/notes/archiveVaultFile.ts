import { promises as fs } from "node:fs";
import path from "node:path";
import { searchIndex } from "../ports/searchIndex.js";
import { recordOperation } from "../../vault/operationLedger.js";
import { resolvePendingByPaths } from "../../vault/changeLog.js";
import {
  archiveTargetPath,
  isArchivedPath,
  withCollisionSuffix,
} from "../../vault/archive.js";
import { safeVaultPath } from "../../safety/pathSafety.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export type ArchiveVaultFileResult = {
  archived: boolean;
  from: string;
  to?: string;
  reindexed: boolean;
  reason?: "missing_source" | "already_archived" | "unsafe_path";
};

/** First archive path under the archive root that is not already taken on disk. */
async function resolveFreeArchivePath(from: string): Promise<string> {
  const base = archiveTargetPath(from);
  const free = async (rel: string): Promise<boolean> => {
    try {
      await fs.access(path.join(VAULT_PATH, rel));
      return false;
    } catch {
      return true;
    }
  };

  if (await free(base)) return base;
  for (let n = 1; ; n++) {
    const candidate = withCollisionSuffix(base, n);
    if (await free(candidate)) return candidate;
  }
}

/**
 * Collision-safe, non-destructive move of a note into `archive/`, with NO index
 * or ledger side effects. The reusable mechanics behind archiving — shared by
 * archiveVaultFileCore and mergeNotesCore, so merge can retire the absorbed copy
 * without emitting a separate `archive` audit record.
 */
export async function moveToArchive(
  from: string,
): Promise<
  { ok: true; to: string } | { ok: false; reason: "missing_source" | "already_archived" | "unsafe_path" }
> {
  if (isArchivedPath(from)) return { ok: false, reason: "already_archived" };

  const fromAbs = safeVaultPath(VAULT_PATH, from);
  if (!fromAbs) return { ok: false, reason: "unsafe_path" };
  try {
    await fs.access(fromAbs);
  } catch {
    return { ok: false, reason: "missing_source" };
  }

  const to = await resolveFreeArchivePath(from);
  const toAbs = path.join(VAULT_PATH, to);
  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.rename(fromAbs, toAbs);
  return { ok: true, to };
}

/**
 * Archive a vault note: move it under `archive/` (preserving its structure),
 * drop it from the search index, and record the operation. Non-destructive —
 * the file still exists on disk, it just leaves the active knowledge picture.
 *
 * Never overwrites (collision-safe destination) and never deletes. Shared by the
 * archiveVaultFile tool; the foundation for merge ("archive the absorbed copy")
 * and superseded-note handling.
 */
export async function archiveVaultFileCore(
  from: string,
  opts: { reason?: string } = {},
): Promise<ArchiveVaultFileResult> {
  const moved = await moveToArchive(from);
  if (!moved.ok) {
    return { archived: false, from, reindexed: false, reason: moved.reason };
  }

  // Archived notes must not surface in RAG. Remove the old path; deliberately do
  // NOT index the archived copy (the archive subtree is excluded everywhere).
  let reindexed = false;
  if (from.endsWith(".md")) {
    await searchIndex().removeFromIndex(from);
    reindexed = true;
  }

  await recordOperation({
    type: "archive",
    targetFiles: [from, moved.to],
    rationale: opts.reason ?? "",
    source: "archiveVaultFile",
    detail: `${from} → ${moved.to}`,
  });
  // Clear any pending change queued for this path — the agent just handled it.
  await resolvePendingByPaths([from]);

  return { archived: true, from, to: moved.to, reindexed };
}
