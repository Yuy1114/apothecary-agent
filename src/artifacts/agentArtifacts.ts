import path from "node:path";
import { promises as fs } from "node:fs";
import type { AgentArtifacts } from "./agentArtifacts.types.js";

export function getAgentArtifacts(vaultPath: string): AgentArtifacts {
  const rootPath = path.join(vaultPath, ".agent");
  const protocolDir = path.join(rootPath, "protocol");

  return {
    rootPath,
    configPath: path.join(rootPath, "config.yaml"),
    protocolDir,
    protocolPath: path.join(protocolDir, "kb_protocol.md"),
    protocolYamlPath: path.join(protocolDir, "kb_protocol.yaml"),
    mapsDir: path.join(rootPath, "maps"),
    reviewsDir: path.join(rootPath, "reviews"),
    metadataDir: path.join(rootPath, "metadata"),
    logsDir: path.join(rootPath, "logs"),
    semanticDir: path.join(rootPath, "semantic"),
    viewsDir: path.join(rootPath, "views"),
  };
}

export async function ensureAgentArtifacts(vaultPath: string): Promise<AgentArtifacts> {
  const artifacts = getAgentArtifacts(vaultPath);
  await Promise.all([
    fs.mkdir(artifacts.protocolDir, { recursive: true }),
    fs.mkdir(artifacts.mapsDir, { recursive: true }),
    fs.mkdir(artifacts.reviewsDir, { recursive: true }),
    fs.mkdir(artifacts.metadataDir, { recursive: true }),
    fs.mkdir(artifacts.logsDir, { recursive: true }),
    fs.mkdir(artifacts.semanticDir, { recursive: true }),
    fs.mkdir(artifacts.viewsDir, { recursive: true }),
  ]);
  return artifacts;
}
