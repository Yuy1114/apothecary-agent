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
import { installPorts } from "./adapters/installPorts.js";
import {
  fullReindexWorkflow,
  fileChangedWorkflow,
  fileDeletedWorkflow,
} from "./workflows/sync-workflow.js";
import { startVaultWatcher } from "./workflows/sync-watcher.js";
import { manualSync } from "../application/sync/manualSync.js";
import { initChangeLog } from "../vault/changeLog.js";
import { initOperationLedger } from "../vault/operationLedger.js";
import { installVaultVersioning } from "../application/versioning/vaultSnapshots.js";
import { initWorkflow } from "./workflows/init.js";
import { reviewWorkflow } from "./workflows/review.js";
import { mapWorkflow } from "./workflows/map.js";
import { refreshSemanticsWorkflow } from "./workflows/refresh-semantics.js";
import { syncSemanticsWorkflow } from "./workflows/sync-semantics.js";
import { manualSyncWorkflow } from "./workflows/manual-sync.js";
import { detectDuplicatesWorkflow } from "./workflows/detect-duplicates.js";
import { refreshProfileWorkflow } from "./workflows/refresh-profile.js";
import { polishNoteWorkflow } from "./workflows/polish-note.js";
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
installPorts(vaultVector);

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
    polishNoteWorkflow,
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

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

// Boot the change-awareness subsystem in order: ledgers first, then a manual
// sync to (a) recover edits made while the process was down and (b) seed the
// hash baseline the watcher diffs against, then start the real-time watcher.
// Runs off the module load so it never blocks the Mastra/Studio server; only
// the watcher's start is gated on the seeding sync completing.
async function bootstrapChangeAwareness(): Promise<void> {
  try {
    await initChangeLog(CHANGE_LOG_DB_PATH);
  } catch (error) {
    console.warn("Change ledger failed to initialize:", error);
  }
  try {
    await initOperationLedger(OPERATIONS_DB_PATH);
  } catch (error) {
    console.warn("Operation ledger failed to initialize:", error);
  }
  // Before the seeding sync, so its recovered-edit snapshot can commit.
  try {
    await installVaultVersioning(VAULT_PATH);
  } catch (error) {
    console.warn("Vault versioning failed to install:", error);
  }
  try {
    await manualSync({ vaultPath: VAULT_PATH });
  } catch (error) {
    console.warn("Startup sync failed to seed the change baseline:", error);
  }
  startVaultWatcher(mastra);
}

void bootstrapChangeAwareness();
