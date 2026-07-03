import { promises as fs } from "node:fs";
import path from "node:path";
import { removeFromIndex } from "./rag.js";
import { recordOperation } from "../../vault/operationLedger.js";
import {
  archiveTargetPath,
  isArchivedPath,
  withCollisionSuffix,
} from "../../vault/archive.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export type ArchiveVaultFileResult = {
  archived: boolean;
  from: string;
  to?: string;
  reindexed: boolean;
  reason?: "missing_source" | "already_archived";
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
  if (isArchivedPath(from)) {
    return { archived: false, from, reindexed: false, reason: "already_archived" };
  }

  const fromAbs = path.join(VAULT_PATH, from);
  try {
    await fs.access(fromAbs);
  } catch {
    return { archived: false, from, reindexed: false, reason: "missing_source" };
  }

  const to = await resolveFreeArchivePath(from);
  const toAbs = path.join(VAULT_PATH, to);

  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.rename(fromAbs, toAbs);

  // Archived notes must not surface in RAG. Remove the old path; deliberately do
  // NOT index the archived copy (the archive subtree is excluded everywhere).
  let reindexed = false;
  if (from.endsWith(".md")) {
    await removeFromIndex(from);
    reindexed = true;
  }

  await recordOperation({
    type: "archive",
    targetFiles: [from, to],
    rationale: opts.reason ?? "",
    source: "archiveVaultFile",
    detail: `${from} → ${to}`,
  });

  return { archived: true, from, to, reindexed };
}
