import type { Mastra } from "@mastra/core/mastra";
import { promises as fs } from "node:fs";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { enqueueChange } from "./../../vault/changeLog.js";
import { isArchivedPath } from "../../vault/archive.js";
import { syncSemanticsFromChanges } from "../../application/semantic/syncSemanticsFromChanges.js";

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
  const absolutePath = path.join(VAULT_PATH, relativePath);

  let exists = false;
  try {
    exists = (await fs.stat(absolutePath)).isFile();
  } catch {
    exists = false;
  }

  // Isolated from the stat above so a workflow failure is never mistaken for a
  // deletion, and never escapes as an unhandled rejection that crashes the host.
  try {
    // Index stays eager so search is always fresh.
    const workflowKey = exists ? FILE_CHANGED_WORKFLOW : FILE_DELETED_WORKFLOW;
    const run = await mastra.getWorkflow(workflowKey).createRun();
    await run.start({ inputData: { filePath: relativePath } });
  } catch (error) {
    console.warn(`Vault watcher: failed to sync ${relativePath}:`, error);
  }

  // Record the change as pending agent-work in the durable ledger.
  try {
    await enqueueChange({
      path: relativePath,
      changeType: exists ? "modified" : "deleted",
      source: "watcher",
    });
  } catch (error) {
    console.warn(`Vault watcher: failed to log change for ${relativePath}:`, error);
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
