import path from "node:path";
import { promises as fs } from "node:fs";
import type { AgentWorkspace } from "../domain/workspace.js";
import { assertAgentWorkspaceWrite } from "../safety/pathSafety.js";

export async function writeJsonArtifact(params: {
  workspace: AgentWorkspace;
  artifactPath: string;
  value: unknown;
}): Promise<void> {
  await writeTextArtifact({
    workspace: params.workspace,
    artifactPath: params.artifactPath,
    content: `${JSON.stringify(params.value, null, 2)}\n`,
  });
}

export async function writeMarkdownArtifact(params: {
  workspace: AgentWorkspace;
  artifactPath: string;
  content: string;
}): Promise<void> {
  await writeTextArtifact({
    workspace: params.workspace,
    artifactPath: params.artifactPath,
    content: `${params.content}\n`,
  });
}

export async function writeTextArtifactIfMissing(params: {
  workspace: AgentWorkspace;
  artifactPath: string;
  content: string;
}): Promise<boolean> {
  assertAgentWorkspaceWrite(params.workspace.rootPath, params.artifactPath);
  const exists = await fs
    .access(params.artifactPath)
    .then(() => true)
    .catch(() => false);

  if (exists) return false;

  await writeTextArtifact(params);
  return true;
}

export async function appendTextArtifact(params: {
  workspace: AgentWorkspace;
  artifactPath: string;
  content: string;
}): Promise<void> {
  assertAgentWorkspaceWrite(params.workspace.rootPath, params.artifactPath);
  await fs.mkdir(path.dirname(params.artifactPath), { recursive: true });
  await fs.appendFile(params.artifactPath, params.content, "utf8");
}

async function writeTextArtifact(params: {
  workspace: AgentWorkspace;
  artifactPath: string;
  content: string;
}): Promise<void> {
  assertAgentWorkspaceWrite(params.workspace.rootPath, params.artifactPath);
  await fs.mkdir(path.dirname(params.artifactPath), { recursive: true });
  await fs.writeFile(params.artifactPath, params.content, "utf8");
}
