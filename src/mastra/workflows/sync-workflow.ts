import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { indexVault, reindexFile, removeFromIndex } from "../tools/rag.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

// ── Steps ──

const indexStep = createStep({
  id: "index-vault",
  inputSchema: z.object({}),
  outputSchema: z.object({ indexed: z.number() }),
  execute: async () => {
    const result = await indexVault();
    return { indexed: result.indexed };
  },
});

const reindexFileStep = createStep({
  id: "reindex-file",
  inputSchema: z.object({ filePath: z.string() }),
  outputSchema: z.object({ added: z.number() }),
  execute: async ({ inputData }) => {
    const result = await reindexFile(inputData.filePath);
    return { added: result.added };
  },
});

const removeFileStep = createStep({
  id: "remove-from-index",
  inputSchema: z.object({ filePath: z.string() }),
  outputSchema: z.object({ removed: z.number() }),
  execute: async ({ inputData }) => {
    const result = await removeFromIndex(inputData.filePath);
    return { removed: result.removed };
  },
});

// ── Workflows ──

export const fullReindexWorkflow = createWorkflow({
  id: "full-reindex",
  inputSchema: z.object({}),
  outputSchema: z.object({ indexed: z.number() }),
})
  .then(indexStep)
  .commit();

export const fileChangedWorkflow = createWorkflow({
  id: "file-changed",
  inputSchema: z.object({ filePath: z.string() }),
  outputSchema: z.object({ added: z.number() }),
})
  .then(reindexFileStep)
  .commit();

export const fileDeletedWorkflow = createWorkflow({
  id: "file-deleted",
  inputSchema: z.object({ filePath: z.string() }),
  outputSchema: z.object({ removed: z.number() }),
})
  .then(removeFileStep)
  .commit();

// ── File watcher ──

let watcher: FSWatcher | null = null;

function toPortablePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isMarkdownPath(p: string): boolean {
  return p.endsWith(".md");
}

export function startVaultWatcher(): void {
  if (watcher) return;
  try {
    watcher = watch(VAULT_PATH, { recursive: true }, (_eventType, filename) => {
      const relativePath = toPortablePath(filename ?? "");
      if (!relativePath || relativePath.startsWith(".")) return;
      if (!isMarkdownPath(relativePath)) return;
      const absolutePath = path.join(VAULT_PATH, relativePath);
      fs.stat(absolutePath)
        .then((stat) => {
          if (stat.isFile()) {
            reindexFile(relativePath).catch(() => {});
          } else {
            removeFromIndex(relativePath).catch(() => {});
          }
        })
        .catch(() => removeFromIndex(relativePath).catch(() => {}));
    });
    console.log("Vault watcher started");
  } catch {
    console.warn("Vault watcher failed to start");
  }
}
