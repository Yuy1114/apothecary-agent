import "dotenv/config";
import { Mastra } from "@mastra/core/mastra";
import { MastraCompositeStore } from "@mastra/core/storage";
import { DuckDBStore } from "@mastra/duckdb";
import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { PinoLogger } from "@mastra/loggers";
import { Observability, MastraStorageExporter, SensitiveDataFilter } from "@mastra/observability";
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
import { applyEditWorkflow } from "./workflows/apply-edit.js";
import {
  handleHealth,
  handleVaultTree,
  handleReadFile,
  handleWriteFile,
  handleRagQuery,
  handleReindex,
} from "./routes.js";
import { EMBEDDING_MODEL } from "./tools/rag.js";
import { workspace } from "./workspaces.js";

const DB_PATH = "file:./local.db";
const OBSERVABILITY_DB_PATH = "./observability.duckdb";

// ── Vector store ──

const vaultVector = new LibSQLVector({ id: "vault-chunks", url: DB_PATH });
setVectorStore(vaultVector);

const applicationStorage = new LibSQLStore({ id: "apothecary-storage", url: DB_PATH });
const observabilityStorage = new DuckDBStore({ id: "apothecary-observability", path: OBSERVABILITY_DB_PATH });

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
    applyEditWorkflow,
  },
  workspace,
  storage: new MastraCompositeStore({
    id: "apothecary-composite-storage",
    default: applicationStorage,
    domains: {
      observability: observabilityStorage.observability,
    },
  }),
  vectors: { vaultChunks: vaultVector },
  logger: new PinoLogger({ name: "apothecary-agent", level: "info" }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: "apothecary-agent",
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
        logging: {
          enabled: true,
          level: "info",
        },
      },
    },
  }),
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
