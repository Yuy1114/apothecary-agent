import { promises as fs } from "node:fs";
import path from "node:path";
import { reindexFile, removeFromIndex } from "./rag.js";
import { recordOperation } from "../../vault/operationLedger.js";
import { resolvePendingByPaths } from "../../vault/changeLog.js";
import { updateReadmesForMove } from "./readme-index-core.js";
import { safeVaultPath } from "../../safety/pathSafety.js";
import { logger } from "../../observability/logger.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export type MoveVaultFileResult = {
  moved: boolean;
  reindexed: boolean;
  reason?: "missing_source" | "collision" | "unsafe_path";
};

/**
 * Move a vault file and keep the vector index in sync. Shared by the
 * moveVaultFile tool and the reorganize workflow.
 *
 * Never overwrites an existing target (a rename would silently destroy it) and
 * never deletes the source directory (structural folders must persist).
 */
export async function moveVaultFileCore(from: string, to: string): Promise<MoveVaultFileResult> {
  const fromAbs = safeVaultPath(VAULT_PATH, from);
  const toAbs = safeVaultPath(VAULT_PATH, to);
  if (!fromAbs || !toAbs) return { moved: false, reindexed: false, reason: "unsafe_path" };

  try {
    await fs.access(fromAbs);
  } catch {
    return { moved: false, reindexed: false, reason: "missing_source" };
  }

  try {
    await fs.access(toAbs);
    // Target exists — refuse to overwrite.
    return { moved: false, reindexed: false, reason: "collision" };
  } catch {
    // Target free — proceed.
  }

  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.rename(fromAbs, toAbs);

  // Keep the vector index in sync; only markdown files participate. Best-effort:
  // the file has already moved on disk, so a failed or timed-out embedding call
  // (unreachable endpoint) must never fail — or hang — the completed move. A stale
  // index is repaired by a later reindex / semantic refresh.
  let reindexed = false;
  try {
    if (from.endsWith(".md")) {
      await removeFromIndex(from);
      reindexed = true;
    }
    if (to.endsWith(".md")) {
      await reindexFile(to);
      reindexed = true;
    }
  } catch (error) {
    reindexed = false;
    logger.warn("move", `reindex failed ${from} → ${to} (index left stale)`, error instanceof Error ? error.message : String(error));
  }

  // Keep directory note-indexes consistent (a README.md is itself an index, so
  // don't index the index). Best-effort: never let it fail the completed move.
  if (from.endsWith(".md") && to.endsWith(".md") && path.posix.basename(to) !== "README.md") {
    try {
      await updateReadmesForMove(VAULT_PATH, from, to);
    } catch (error) {
      console.warn(`moveVaultFile: README index update failed for ${from} → ${to}:`, error);
    }
  }

  await recordOperation({
    type: "move",
    targetFiles: [from, to],
    source: "moveVaultFile",
    detail: `${from} → ${to}`,
  });
  // The agent handled these paths, so clear any change queued for them earlier
  // (e.g. an inbox file that manual sync flagged as "created") — otherwise it
  // lingers as a stale pending change after it has already been moved.
  await resolvePendingByPaths([from, to]);

  return { moved: true, reindexed };
}
