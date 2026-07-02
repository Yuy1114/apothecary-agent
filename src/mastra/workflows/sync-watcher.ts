import type { Mastra } from "@mastra/core/mastra";
import { promises as fs } from "node:fs";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

let watcher: FSWatcher | null = null;

function toPortablePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isMarkdownPath(p: string): boolean {
  return p.endsWith(".md");
}

function isIgnoredPath(relativePath: string): boolean {
  return relativePath.startsWith(".");
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
    const workflowKey = exists ? FILE_CHANGED_WORKFLOW : FILE_DELETED_WORKFLOW;
    const run = await mastra.getWorkflow(workflowKey).createRun();
    await run.start({ inputData: { filePath: relativePath } });
  } catch (error) {
    console.warn(`Vault watcher: failed to sync ${relativePath}:`, error);
  }
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
