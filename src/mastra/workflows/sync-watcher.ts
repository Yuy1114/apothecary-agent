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

export function startVaultWatcher(mastra: Mastra): void {
  if (watcher) return;
  try {
    watcher = watch(VAULT_PATH, { recursive: true }, async (_eventType, filename) => {
      const relativePath = toPortablePath(filename ?? "");
      if (!relativePath || isIgnoredPath(relativePath)) return;
      if (!isMarkdownPath(relativePath)) return;

      const absolutePath = path.join(VAULT_PATH, relativePath);
      try {
        const stat = await fs.stat(absolutePath);
        if (stat.isFile()) {
          const run = await mastra.getWorkflow("file-changed").createRun();
          await run.start({ inputData: { filePath: relativePath } });
        }
      } catch {
        const run = await mastra.getWorkflow("file-deleted").createRun();
        await run.start({ inputData: { filePath: relativePath } });
      }
    });
    console.log("Vault watcher started");
  } catch {
    console.warn("Vault watcher failed to start");
  }
}
