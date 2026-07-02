import "dotenv/config";
import { Mastra } from "@mastra/core/mastra";
import { MastraCompositeStore } from "@mastra/core/storage";
import { DuckDBStore } from "@mastra/duckdb";
import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { PinoLogger } from "@mastra/loggers";
import {
  Observability,
  MastraStorageExporter,
  SensitiveDataFilter,
} from "@mastra/observability";

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
import { EMBEDDING_MODEL } from "./tools/rag.js";
import { workspace } from "./workspaces.js";
import path from "path";

function getProjectRoot() {
  const cwd = process.cwd();
  const devRuntimePath = `${path.sep}src${path.sep}mastra${path.sep}public`;
  const buildRuntimePath = `${path.sep}.mastra${path.sep}output`;

  if (cwd.includes(devRuntimePath)) {
    return cwd.slice(0, cwd.indexOf(devRuntimePath));
  }
  if (cwd.includes(buildRuntimePath)) {
    return cwd.slice(0, cwd.indexOf(buildRuntimePath));
  }
  return cwd;
}

const projectRoot = getProjectRoot();

const DB_PATH = `file:${path.resolve(projectRoot, "sql/local.db")}`;
const VECTOR_DB_PATH = `file:${path.resolve(projectRoot, "sql/vectors.db")}`;
const OBSERVABILITY_DB_PATH = path.resolve(
  projectRoot,
  "sql/observability.duckdb"
);
// ── Vector store ──

const vaultVector = new LibSQLVector({
  id: "vault-chunks",
  url: VECTOR_DB_PATH,
});
setVectorStore(vaultVector);

const applicationStorage = new LibSQLStore({
  id: "apothecary-storage",
  url: DB_PATH,
});
const observabilityStorage = new DuckDBStore({
  id: "apothecary-observability",
  path: OBSERVABILITY_DB_PATH,
});

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
      embedder: EMBEDDING_MODEL as any,
      options: {
        lastMessages: 20,
        observationalMemory: true,
        workingMemory: { enabled: true },
      },
    }),
  },
});

startVaultWatcher();
