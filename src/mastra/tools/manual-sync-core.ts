import { scanVault } from "../../vault/scanner.js";
import { VAULT_IGNORE_GLOBS } from "../../domain/vaultPolicy.js";
import { searchIndex } from "../../application/ports/searchIndex.js";
import { enqueueChange } from "../../vault/changeLog.js";
import {
  loadSnapshot,
  saveSnapshot,
  diffSnapshot,
  type SnapshotFiles,
} from "../../vault/syncSnapshot.js";
import { syncSemanticsFromChanges } from "../../application/semantic/syncSemanticsFromChanges.js";
import { nowIso } from "../../utils/time.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";

export type ManualSyncReport = {
  created: number;
  modified: number;
  deleted: number;
  unchanged: number;
  /** Whether the semantic layer refresh was chained (only when something changed). */
  semanticRefreshed: boolean;
};

type RefreshSemantics = (input: { vaultPath: string }) => Promise<unknown>;

/**
 * Manual sync: the watcher's compensation path. Scans the vault, diffs it
 * against the last snapshot to recover created/modified/deleted markdown files
 * the watcher may have missed (or that changed while the process was down),
 * then keeps the index, change ledger, snapshot and semantic layer consistent.
 *
 * Unlike the real-time watcher — which can only tell "exists" from "gone" and
 * so records every existing file as `modified` — the snapshot diff distinguishes
 * `created` from `modified` accurately. It touches no user notes.
 */
export async function manualSync(
  input: { vaultPath: string },
  deps: { refreshSemantics: RefreshSemantics } = { refreshSemantics: syncSemanticsFromChanges },
): Promise<ManualSyncReport> {
  const scan = await scanVault({
    vaultPath: input.vaultPath,
    includeHash: true,
    ignore: VAULT_IGNORE_GLOBS,
  });

  const current: SnapshotFiles = {};
  for (const file of scan.files) {
    if (file.mediaType === "markdown") current[file.path] = { hash: file.hash ?? "" };
  }

  const previous = await loadSnapshot(apothecaryHome());
  const diff = diffSnapshot(previous.files, current);

  // Keep the vector index fresh (the watcher normally does this eagerly).
  for (const p of [...diff.created, ...diff.modified]) await searchIndex().reindexFile(p);
  for (const p of diff.deleted) await searchIndex().removeFromIndex(p);

  // Record the recovered changes as pending agent-work, correctly typed.
  for (const p of diff.created) await enqueueChange({ path: p, changeType: "created", source: "manual" });
  for (const p of diff.modified) await enqueueChange({ path: p, changeType: "modified", source: "manual" });
  for (const p of diff.deleted) await enqueueChange({ path: p, changeType: "deleted", source: "manual" });

  await saveSnapshot(apothecaryHome(), { generatedAt: nowIso(), files: current });

  // Chain the incremental semantic refresh so the understanding layer catches up
  // too — only when something actually changed, to avoid needless LLM work.
  const changed = diff.created.length + diff.modified.length + diff.deleted.length > 0;
  if (changed) await deps.refreshSemantics({ vaultPath: input.vaultPath });

  return {
    created: diff.created.length,
    modified: diff.modified.length,
    deleted: diff.deleted.length,
    unchanged: diff.unchanged.length,
    semanticRefreshed: changed,
  };
}
