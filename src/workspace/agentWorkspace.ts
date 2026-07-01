import path from "node:path";
import { promises as fs } from "node:fs";
import type { AgentWorkspace } from "../domain/workspace.js";

export function getAgentWorkspace(vaultPath: string): AgentWorkspace {
  const rootPath = path.join(vaultPath, ".agent");
  const protocolDir = path.join(rootPath, "protocol");

  return {
    rootPath,
    protocolDir,
    protocolPath: path.join(protocolDir, "kb_protocol.md"),
    protocolYamlPath: path.join(protocolDir, "kb_protocol.yaml"),
    mapsDir: path.join(rootPath, "maps"),
    reviewsDir: path.join(rootPath, "reviews"),
    metadataDir: path.join(rootPath, "metadata"),
    logsDir: path.join(rootPath, "logs"),
  };
}

export async function ensureAgentWorkspace(vaultPath: string): Promise<AgentWorkspace> {
  const workspace = getAgentWorkspace(vaultPath);
  await Promise.all([
    fs.mkdir(workspace.protocolDir, { recursive: true }),
    fs.mkdir(workspace.mapsDir, { recursive: true }),
    fs.mkdir(workspace.reviewsDir, { recursive: true }),
    fs.mkdir(workspace.metadataDir, { recursive: true }),
    fs.mkdir(workspace.logsDir, { recursive: true }),
  ]);
  return workspace;
}
