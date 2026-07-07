import type { Mastra } from "@mastra/core/mastra";
import { promises as fs } from "node:fs";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { enqueueChange } from "./../../vault/changeLog.js";
import { isSelfWrite } from "../../vault/selfWriteGuard.js";
import { isArchivedPath } from "../../vault/archive.js";
import { hashFile } from "../../vault/hash.js";
import { loadSnapshot, commitSelfWrite } from "../../vault/syncSnapshot.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";
import { syncSemanticsFromChanges } from "../../application/semantic/syncSemanticsFromChanges.js";

export type WatchClassification = "unchanged" | "created" | "modified" | "deleted";

/**
 * Classify a watcher event by comparing the file's current content hash against
 * the sync baseline. Pure and deterministic (mirrors `diffSnapshot`): a null
 * current hash means the file is gone; a null baseline hash means it was not
 * previously accounted for. An unregistered path is external work iff its
 * content no longer matches the baseline.
 */
export function classifyWatchEvent(
  currentHash: string | null,
  baselineHash: string | null,
): WatchClassification {
  if (currentHash === null) return baselineHash === null ? "unchanged" : "deleted";
  if (baselineHash === null) return "created";
  return currentHash === baselineHash ? "unchanged" : "modified";
}

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

// Debounce the semantic refresh: a save burst (or a batch import) should settle
// into a single incremental pass rather than one LLM summary run per fs event.
const SEMANTIC_SYNC_DEBOUNCE_MS = Number(
  process.env.APOTHECARY_SEMANTIC_SYNC_DEBOUNCE_MS ?? 8_000,
);

let watcher: FSWatcher | null = null;
let semanticSyncTimer: ReturnType<typeof setTimeout> | null = null;
let semanticSyncRunning = false;
let semanticSyncPending = false;

function toPortablePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isMarkdownPath(p: string): boolean {
  return p.endsWith(".md");
}

function isIgnoredPath(relativePath: string): boolean {
  // Dotfiles/dirs (.agent, .obsidian, …) and the archive subtree are not active
  // vault content — archived notes must not re-enter the change→semantic pipeline.
  return relativePath.startsWith(".") || isArchivedPath(relativePath);
}

// Mastra.getWorkflow() resolves by registration key (see index.ts), NOT the
// workflow's internal id. These must match the keys used when registering.
const FILE_CHANGED_WORKFLOW = "fileChangedWorkflow";
const FILE_DELETED_WORKFLOW = "fileDeletedWorkflow";

async function syncChange(mastra: Mastra, relativePath: string): Promise<void> {
  // A system operation is mid-write on this path: it owns the index, ledger and
  // baseline for it, so the watcher must stay out entirely.
  if (isSelfWrite(relativePath)) return;

  const absolutePath = path.join(VAULT_PATH, relativePath);

  // Hash the current content (null = gone) and compare against the baseline.
  // Only a genuine mismatch — new file, changed content, or a deletion — counts
  // as external work; a self-write echo already matches the baseline.
  let currentHash: string | null = null;
  try {
    if ((await fs.stat(absolutePath)).isFile()) currentHash = await hashFile(absolutePath);
  } catch {
    currentHash = null;
  }

  const baseline = await loadSnapshot(apothecaryHome());
  const classification = classifyWatchEvent(currentHash, baseline.files[relativePath]?.hash ?? null);
  if (classification === "unchanged") return;

  // Isolated from the stat above so a workflow failure is never mistaken for a
  // deletion, and never escapes as an unhandled rejection that crashes the host.
  try {
    // Index stays eager so search is always fresh.
    const workflowKey = currentHash !== null ? FILE_CHANGED_WORKFLOW : FILE_DELETED_WORKFLOW;
    const run = await mastra.getWorkflow(workflowKey).createRun();
    await run.start({ inputData: { filePath: relativePath } });
  } catch (error) {
    console.warn(`Vault watcher: failed to sync ${relativePath}:`, error);
  }

  // Record the external change as pending agent-work, accurately typed — the
  // hash diff lets the watcher tell created from modified, unlike the old
  // exists-only check.
  try {
    await enqueueChange({ path: relativePath, changeType: classification, source: "watcher" });
  } catch (error) {
    console.warn(`Vault watcher: failed to log change for ${relativePath}:`, error);
  }

  // Fold the change into the baseline so the duplicate events a single write
  // emits, and the next manual sync, agree it is now accounted for.
  try {
    await commitSelfWrite(VAULT_PATH, [relativePath]);
  } catch (error) {
    console.warn(`Vault watcher: failed to update baseline for ${relativePath}:`, error);
  }

  // Keep the semantic layer live: refresh summaries/graph for the changed files
  // once the burst settles. Debounced and isolated so it never crashes the host.
  scheduleSemanticSync();
}

async function runSemanticSync(): Promise<void> {
  // A refresh is already in flight — remember to run once more when it settles so
  // changes that landed mid-pass are picked up.
  if (semanticSyncRunning) {
    semanticSyncPending = true;
    return;
  }
  semanticSyncRunning = true;
  try {
    const report = await syncSemanticsFromChanges({ vaultPath: VAULT_PATH });
    if (report.refreshed || report.pruned) {
      console.log(
        `Vault watcher: semantic layer synced (refreshed=${report.refreshed}, pruned=${report.pruned})`,
      );
    }
  } catch (error) {
    console.warn("Vault watcher: semantic sync failed:", error);
  } finally {
    semanticSyncRunning = false;
    if (semanticSyncPending) {
      semanticSyncPending = false;
      scheduleSemanticSync();
    }
  }
}

function scheduleSemanticSync(): void {
  if (semanticSyncTimer) clearTimeout(semanticSyncTimer);
  semanticSyncTimer = setTimeout(() => {
    semanticSyncTimer = null;
    void runSemanticSync();
  }, SEMANTIC_SYNC_DEBOUNCE_MS);
}

export function startVaultWatcher(mastra: Mastra): void {
  if (watcher) return;
  try {
    watcher = watch(VAULT_PATH, { recursive: true }, (_eventType, filename) => {
      const relativePath = toPortablePath(filename ?? "");
      if (!relativePath || isIgnoredPath(relativePath)) return;
      if (!isMarkdownPath(relativePath)) return;
      void syncChange(mastra, relativePath);
    });
    console.log("Vault watcher started");
  } catch {
    console.warn("Vault watcher failed to start");
  }
}
