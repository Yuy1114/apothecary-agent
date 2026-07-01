import "dotenv/config";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { PinoLogger } from "@mastra/loggers";
import { registerApiRoute } from "@mastra/core/server";

import { vaultReviewer } from "./agents/vault-reviewer.js";
import { vaultCurator } from "./agents/vault-curator.js";
import { vaultIngestor } from "./agents/vault-ingestor.js";
import { setVectorStore } from "./tools/rag.js";
import {
  startVaultWatcher,
  fullReindexWorkflow,
  fileChangedWorkflow,
  fileDeletedWorkflow,
} from "./workflows/sync-workflow.js";
import { initWorkflow } from "./workflows/init.js";
import { reviewWorkflow } from "./workflows/review.js";
import { mapWorkflow } from "./workflows/map.js";
import {
  handleHealth,
  handleVaultTree,
  handleReadFile,
  handleWriteFile,
  handleRagQuery,
  handleReindex,
} from "./routes.js";
import { EMBEDDING_MODEL } from "./tools/rag.js";

const DB_PATH = "file:./local.db";

// ── Vector store ──

const vaultVector = new LibSQLVector({ id: "vault-chunks", url: DB_PATH });
setVectorStore(vaultVector);

// ── Mastra instance ──

export const mastra = new Mastra({
  agents: { vaultReviewer, vaultCurator, vaultIngestor },
  workflows: {
    fullReindexWorkflow,
    fileChangedWorkflow,
    fileDeletedWorkflow,
    initWorkflow,
    reviewWorkflow,
    mapWorkflow,
  },
  storage: new LibSQLStore({ id: "apothecary-storage", url: DB_PATH }),
  vectors: { vaultChunks: vaultVector },
  logger: new PinoLogger({ name: "apothecary-agent", level: "info" }),
  memory: {
    apothecary: new Memory({
      embedder: EMBEDDING_MODEL,
      options: {
        lastMessages: 20,
        observationalMemory: true,
        workingMemory: { enabled: true },
      },
    }),
  },
  server: {
    port: Number(process.env.APOTHECARY_UI_PORT ?? 8787),
    apiRoutes: [
      registerApiRoute("/health", { method: "GET", handler: handleHealth }),
      registerApiRoute("/vault/tree", {
        method: "GET",
        handler: handleVaultTree,
      }),
      registerApiRoute("/vault/files", {
        method: "GET",
        handler: handleReadFile,
      }),
      registerApiRoute("/vault/files", {
        method: "PUT",
        handler: handleWriteFile,
      }),
      registerApiRoute("/rag/query", {
        method: "POST",
        handler: handleRagQuery,
      }),
      registerApiRoute("/index", { method: "POST", handler: handleReindex }),
    ],
  },
});

startVaultWatcher();
