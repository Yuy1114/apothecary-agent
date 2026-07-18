import path from "node:path";
import { markChangesSnapshotted } from "../../vault/changeLog.js";
import {
  setOperationSnapshotHook,
  type OperationSnapshotInput,
} from "../../vault/operationLedger.js";
import {
  commitSnapshot,
  ensureVaultRepo,
  vaultVersioningEnabled,
} from "../../vault/versioning.js";

/**
 * Orchestrates vault version control over the git plumbing in
 * vault/versioning.ts: installs the per-operation snapshot hook on the
 * operation ledger, and turns settled batches of external edits into commits
 * stamped back onto their change-log rows.
 */

const RELOCATING = new Set<OperationSnapshotInput["type"]>(["move", "archive", "merge"]);

/** Commit subject+body for an agent operation (internal artifact → English). */
export function agentCommitMessage(op: OperationSnapshotInput): string {
  const files = op.targetFiles.filter(Boolean);
  const relocated = RELOCATING.has(op.type) && files.length >= 2;
  const subject = relocated
    ? `agent: ${op.type} ${files[0]} -> ${files.at(-1)}`
    : `agent: ${op.type} ${files[0] ?? ""}`.trim();
  const body = op.rationale || op.detail;
  return body ? `${subject}\n\n${body}` : subject;
}

/**
 * Appliers also rewrite the README index of every directory they touch (see
 * updateReadmesForMove) without listing it in targetFiles — include those in
 * the snapshot so index edits don't linger uncommitted. A README pathspec that
 * didn't change stages nothing and is free.
 */
export function snapshotPathsFor(targetFiles: string[]): string[] {
  const paths = targetFiles.filter(Boolean).map((p) => p.replace(/\\/g, "/"));
  const readmes = paths.map((p) => path.posix.join(path.posix.dirname(p), "README.md"));
  return [...new Set([...paths, ...readmes])];
}

/**
 * Enable vault versioning: make sure the repo exists and wire the operation
 * ledger so every applied agent operation becomes one scoped commit. Returns
 * false (and installs nothing) when disabled or when git setup fails —
 * snapshots must never become a precondition for applying changes.
 */
export async function installVaultVersioning(vaultPath: string): Promise<boolean> {
  if (!vaultVersioningEnabled()) return false;
  try {
    await ensureVaultRepo(vaultPath);
  } catch (error) {
    console.warn("Vault versioning: repo setup failed, snapshots disabled:", error);
    return false;
  }
  setOperationSnapshotHook((op) => {
    const paths = snapshotPathsFor(op.targetFiles);
    if (paths.length === 0) return Promise.resolve(null);
    return commitSnapshot(vaultPath, agentCommitMessage(op), paths);
  });
  return true;
}

/**
 * Commit a settled batch of external (non-agent) edits and stamp the sha onto
 * the change rows enqueued for them since `since`. Null when versioning is off
 * or the batch turned out to be already captured (e.g. a startup catch-up
 * commit beat the row-enqueueing sync to it).
 */
export async function snapshotExternalChanges(
  vaultPath: string,
  paths: string[],
  since: string,
): Promise<string | null> {
  if (!vaultVersioningEnabled()) return null;
  const unique = [...new Set(paths)].filter(Boolean);
  if (unique.length === 0) return null;
  const subject =
    unique.length === 1
      ? `manual: external edit ${unique[0]}`
      : `manual: ${unique.length} external edits`;
  const sha = await commitSnapshot(vaultPath, subject, unique);
  if (sha) await markChangesSnapshotted(unique, sha, since);
  return sha;
}
