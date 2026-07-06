import "dotenv/config";
import { Mastra } from "@mastra/core/mastra";
import { MastraCompositeStore } from "@mastra/core/storage";
import { DuckDBStore } from "@mastra/duckdb";
import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { PinoLogger } from "@mastra/loggers";
import {
  Observability,
  MastraStorageExporter,
  SensitiveDataFilter,
} from "@mastra/observability";

import { apothecaryAgent } from "./agents/apothecary-agent.js";
import { setVectorStore } from "./tools/rag.js";
import {
  fullReindexWorkflow,
  fileChangedWorkflow,
  fileDeletedWorkflow,
} from "./workflows/sync-workflow.js";
import { startVaultWatcher } from "./workflows/sync-watcher.js";
import { initChangeLog } from "../vault/changeLog.js";
import { initOperationLedger } from "../vault/operationLedger.js";
import { initWorkflow } from "./workflows/init.js";
import { reviewWorkflow } from "./workflows/review.js";
import { mapWorkflow } from "./workflows/map.js";
import { refreshSemanticsWorkflow } from "./workflows/refresh-semantics.js";
import { syncSemanticsWorkflow } from "./workflows/sync-semantics.js";
import { manualSyncWorkflow } from "./workflows/manual-sync.js";
import { detectDuplicatesWorkflow } from "./workflows/detect-duplicates.js";
import { refreshProfileWorkflow } from "./workflows/refresh-profile.js";
import { workspace } from "./workspaces.js";
import { apothecaryMemory } from "./memory.js";
import { apothecaryDb } from "../config/apothecaryDb.js";
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

// Agent-state DBs live in the global agent home; only dev telemetry
// (observability.duckdb) stays in the project's sql/.
const DB_PATH = apothecaryDb.studioStore();
const VECTOR_DB_PATH = apothecaryDb.vectors();
const CHANGE_LOG_DB_PATH = apothecaryDb.changeLog();
const OPERATIONS_DB_PATH = apothecaryDb.operations();
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
  agents: { apothecaryAgent },
  workflows: {
    fullReindexWorkflow,
    fileChangedWorkflow,
    fileDeletedWorkflow,
    initWorkflow,
    reviewWorkflow,
    mapWorkflow,
    refreshSemanticsWorkflow,
    syncSemanticsWorkflow,
    manualSyncWorkflow,
    detectDuplicatesWorkflow,
    refreshProfileWorkflow,
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
    apothecary: apothecaryMemory,
  },
});

initChangeLog(CHANGE_LOG_DB_PATH)
  .catch((error) => console.warn("Change ledger failed to initialize:", error));
initOperationLedger(OPERATIONS_DB_PATH)
  .catch((error) => console.warn("Operation ledger failed to initialize:", error));
startVaultWatcher(mastra);
