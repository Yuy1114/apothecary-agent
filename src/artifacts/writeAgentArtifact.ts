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

async function writeTextArtifact(params: {
  workspace: AgentWorkspace;
  artifactPath: string;
  content: string;
}): Promise<void> {
  assertAgentWorkspaceWrite(params.workspace.rootPath, params.artifactPath);
  await fs.mkdir(path.dirname(params.artifactPath), { recursive: true });
  await fs.writeFile(params.artifactPath, params.content, "utf8");
}
