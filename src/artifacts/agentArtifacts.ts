import path from "node:path";
import { promises as fs } from "node:fs";
import type { AgentArtifacts } from "./agentArtifacts.types.js";
import { apothecaryHome } from "../config/apothecaryHome.js";

/**
 * Resolve the agent's artifact paths under a home root. Defaults to the global
 * `~/.apothecary` (see APOTHECARY_HOME); tests pass a temp dir for isolation.
 *
 * `root` is the artifact home directly — no longer `<vault>/.agent`. The agent
 * maintains its own internal layout here (config + working subdirs).
 */
export function getAgentArtifacts(root: string = apothecaryHome()): AgentArtifacts {
  const rootPath = root;
  const protocolDir = path.join(rootPath, "protocol");

  return {
    rootPath,
    // config.yaml is the human-editable charter; engine.yaml holds the technical
    // runtime config (reviewer/scan/map/review). AGENT.md is the behaviour charter.
    configPath: path.join(rootPath, "config.yaml"),
    enginePath: path.join(rootPath, "engine.yaml"),
    agentMdPath: path.join(rootPath, "AGENT.md"),
    protocolDir,
    protocolPath: path.join(protocolDir, "kb_protocol.md"),
    protocolYamlPath: path.join(protocolDir, "kb_protocol.yaml"),
    mapsDir: path.join(rootPath, "maps"),
    reviewsDir: path.join(rootPath, "reviews"),
    metadataDir: path.join(rootPath, "metadata"),
    logsDir: path.join(rootPath, "logs"),
    semanticDir: path.join(rootPath, "semantic"),
    viewsDir: path.join(rootPath, "views"),
    profileDir: path.join(rootPath, "profile"),
    indexDir: path.join(rootPath, "index"),
    memoryDir: path.join(rootPath, "memory"),
    queueDir: path.join(rootPath, "queue"),
  };
}

export async function ensureAgentArtifacts(root: string = apothecaryHome()): Promise<AgentArtifacts> {
  const artifacts = getAgentArtifacts(root);
  await Promise.all([
    fs.mkdir(artifacts.protocolDir, { recursive: true }),
    fs.mkdir(artifacts.mapsDir, { recursive: true }),
    fs.mkdir(artifacts.reviewsDir, { recursive: true }),
    fs.mkdir(artifacts.metadataDir, { recursive: true }),
    fs.mkdir(artifacts.logsDir, { recursive: true }),
    fs.mkdir(artifacts.semanticDir, { recursive: true }),
    fs.mkdir(artifacts.viewsDir, { recursive: true }),
    fs.mkdir(artifacts.profileDir, { recursive: true }),
    fs.mkdir(artifacts.indexDir, { recursive: true }),
    fs.mkdir(artifacts.memoryDir, { recursive: true }),
    fs.mkdir(artifacts.queueDir, { recursive: true }),
  ]);
  return artifacts;
}
