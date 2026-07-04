import os from "node:os";
import path from "node:path";

/**
 * Global, vault-independent home for the agent's own config and working files.
 *
 * Historically the agent kept its artifacts under `<vault>/.agent`. The workspace
 * was redesigned so this lives in the user's home as `~/.apothecary` — a single
 * local config folder shared across vaults rather than one buried inside a vault.
 * Layout (agent-maintained): config.yaml + AGENT.md + engine.yaml at the root,
 * plus working subdirs (index/, memory/, logs/, queue/, semantic/, profile/, …).
 *
 * Resolved dynamically (not a module-load constant) so tests can point it at a
 * temp dir via `APOTHECARY_HOME` without racing import order.
 */
export function apothecaryHome(): string {
  return path.resolve(process.env.APOTHECARY_HOME ?? path.join(os.homedir(), ".apothecary"));
}
