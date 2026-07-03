import path from "node:path";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { apothecaryAgent } from "../mastra/agents/apothecary-agent.js";
import { setVectorStore } from "../mastra/tools/rag.js";
import { fileChangedWorkflow, fileDeletedWorkflow } from "../mastra/workflows/sync-workflow.js";
import { startVaultWatcher } from "../mastra/workflows/sync-watcher.js";
import { workspace } from "../mastra/workspaces.js";
import { apothecaryMemory } from "../mastra/memory.js";

/**
 * Electron gets a small Mastra host rather than importing Studio's full runtime.
 * In particular, it avoids the DuckDB observability file, so Studio and the
 * desktop app can run side-by-side without a process-level lock conflict.
 */
export function createDesktopRuntime(projectRoot: string) {
  const vectorStore = new LibSQLVector({
    id: "vault-chunks",
    url: `file:${path.join(projectRoot, "sql", "vectors.db")}`,
  });
  setVectorStore(vectorStore);

  const runtime = new Mastra({
    agents: { apothecaryAgent },
    workflows: { fileChangedWorkflow, fileDeletedWorkflow },
    storage: new LibSQLStore({
      id: "apothecary-desktop-storage",
      url: `file:${path.join(projectRoot, "sql", "desktop-local.db")}`,
    }),
    vectors: { vaultChunks: vectorStore },
    workspace,
    memory: { apothecary: apothecaryMemory },
  });

  // Live change awareness is on by default (the packaged app owns its own
  // databases, so there is no conflict). Set APOTHECARY_DESKTOP_WATCH=0 when
  // running `desktop:dev` alongside `mastra dev`, which shares the repo's sql/
  // and its watcher — then this process observes via the shared ledgers instead
  // of starting a second, redundant watcher.
  if (process.env.APOTHECARY_DESKTOP_WATCH !== "0") {
    startVaultWatcher(runtime);
  }
  return runtime;
}
