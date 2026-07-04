import { mkdirSync } from "node:fs";
import path from "node:path";
import { apothecaryHome } from "./apothecaryHome.js";

/**
 * Runtime databases live in the global agent home (~/.apothecary), not inside the
 * project or a vault — the last piece of agent state to leave the repo. Layout
 * mirrors AGENT.md: the vector index under `index/`, agent memory under `memory/`,
 * the pending-change queue under `queue/`, the operation ledger at the root.
 *
 * Each resolver ensures its parent dir exists (LibSQL/SQLite won't create it) and
 * returns a `file:` URL ready for LibSQLStore/LibSQLVector.
 *
 * NOTE: dev telemetry (observability.duckdb) intentionally stays in the project's
 * `sql/` — it is debugging instrumentation, not agent knowledge state.
 */
function dbUrl(...segments: string[]): string {
  const abs = path.join(apothecaryHome(), ...segments);
  mkdirSync(path.dirname(abs), { recursive: true });
  return `file:${abs}`;
}

export const apothecaryDb = {
  /** RAG vector index (rebuildable). Shared by Studio and the desktop app. */
  vectors: () => dbUrl("index", "vectors.db"),
  /** Studio's Mastra store: conversation memory, working memory, workflow runs. */
  studioStore: () => dbUrl("memory", "studio.db"),
  /** Desktop app's separate Mastra store (kept apart to avoid lock contention). */
  desktopStore: () => dbUrl("memory", "desktop.db"),
  /** Pending-change ledger (agent work queue). */
  changeLog: () => dbUrl("queue", "change-log.db"),
  /** Operation audit ledger (durable trace of what the agent did). */
  operations: () => dbUrl("operations.db"),
};
