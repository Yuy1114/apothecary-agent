import { promises as fs } from "node:fs";
import path from "node:path";
import { reindexFile, removeFromIndex } from "./rag.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export type MoveVaultFileResult = {
  moved: boolean;
  reindexed: boolean;
  reason?: "missing_source" | "collision";
};

/**
 * Move a vault file and keep the vector index in sync. Shared by the
 * moveVaultFile tool and the reorganize workflow.
 *
 * Never overwrites an existing target (a rename would silently destroy it) and
 * never deletes the source directory (structural folders must persist).
 */
export async function moveVaultFileCore(from: string, to: string): Promise<MoveVaultFileResult> {
  const fromAbs = path.join(VAULT_PATH, from);
  const toAbs = path.join(VAULT_PATH, to);

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

  // Keep the vector index in sync; only markdown files participate.
  let reindexed = false;
  if (from.endsWith(".md")) {
    await removeFromIndex(from);
    reindexed = true;
  }
  if (to.endsWith(".md")) {
    await reindexFile(to);
    reindexed = true;
  }

  return { moved: true, reindexed };
}
