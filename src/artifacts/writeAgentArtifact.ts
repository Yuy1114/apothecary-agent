import path from "node:path";
import { promises as fs } from "node:fs";
import type { AgentArtifacts } from "./agentArtifacts.types.js";
import { assertAgentArtifactsWrite } from "../safety/pathSafety.js";

export async function writeJsonArtifact(params: {
  artifacts: AgentArtifacts;
  artifactPath: string;
  value: unknown;
}): Promise<void> {
  await writeTextArtifact({
    artifacts: params.artifacts,
    artifactPath: params.artifactPath,
    content: `${JSON.stringify(params.value, null, 2)}\n`,
  });
}

export async function writeMarkdownArtifact(params: {
  artifacts: AgentArtifacts;
  artifactPath: string;
  content: string;
}): Promise<void> {
  await writeTextArtifact({
    artifacts: params.artifacts,
    artifactPath: params.artifactPath,
    content: `${params.content}\n`,
  });
}

export async function writeTextArtifactIfMissing(params: {
  artifacts: AgentArtifacts;
  artifactPath: string;
  content: string;
}): Promise<boolean> {
  assertAgentArtifactsWrite(params.artifacts.rootPath, params.artifactPath);
  const exists = await fs
    .access(params.artifactPath)
    .then(() => true)
    .catch(() => false);

  if (exists) return false;

  await writeTextArtifact(params);
  return true;
}

export async function appendTextArtifact(params: {
  artifacts: AgentArtifacts;
  artifactPath: string;
  content: string;
}): Promise<void> {
  assertAgentArtifactsWrite(params.artifacts.rootPath, params.artifactPath);
  await fs.mkdir(path.dirname(params.artifactPath), { recursive: true });
  await fs.appendFile(params.artifactPath, params.content, "utf8");
}

async function writeTextArtifact(params: {
  artifacts: AgentArtifacts;
  artifactPath: string;
  content: string;
}): Promise<void> {
  assertAgentArtifactsWrite(params.artifacts.rootPath, params.artifactPath);
  await fs.mkdir(path.dirname(params.artifactPath), { recursive: true });
  await fs.writeFile(params.artifactPath, params.content, "utf8");
}
