import {
  enqueueChange,
  listPendingChanges,
  resolveChanges,
} from "../../vault/changeLog.js";
import { syncSemanticsForPaths } from "./syncSemanticsFromChanges.js";

/**
 * Durable recovery for a failed post-apply semantic refresh. The proposal's file
 * change already succeeded (so it stays `applied`), but the semantic layer is
 * now stale. Rather than losing that in a warning, we record the affected paths
 * as pending change-ledger work with source `proposal` — visible to the user and
 * retried by manual sync or the dedicated retry tool.
 */
export async function enqueueSemanticRecovery(paths: string[]): Promise<void> {
  for (const path of paths) {
    await enqueueChange({ path, changeType: "modified", source: "proposal" });
  }
}

export type SemanticRecoveryReport = { pending: number; resolved: number };

/**
 * Retry outstanding post-apply recovery work: refresh the semantic layer for the
 * `proposal`-sourced pending changes and resolve them on success. Idempotent and
 * side-effect-free on user notes (it only rebuilds semantic artifacts), so it is
 * safe to run repeatedly; on failure the work stays pending for the next retry.
 */
type SyncPaths = (input: { vaultPath: string; paths: string[] }) => Promise<unknown>;

export async function retrySemanticRecovery(
  input: { vaultPath: string },
  deps: { syncPaths: SyncPaths } = { syncPaths: (i) => syncSemanticsForPaths(i) },
): Promise<SemanticRecoveryReport> {
  const recovery = (await listPendingChanges()).filter((change) => change.source === "proposal");
  if (recovery.length === 0) return { pending: 0, resolved: 0 };

  const paths = [...new Set(recovery.map((change) => change.path))];
  try {
    await deps.syncPaths({ vaultPath: input.vaultPath, paths });
  } catch {
    return { pending: recovery.length, resolved: 0 };
  }

  const resolved = await resolveChanges(
    recovery.map((change) => change.id),
    "processed",
  );
  return { pending: recovery.length, resolved };
}
