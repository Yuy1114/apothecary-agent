import { promises as fs } from "node:fs";
import path from "node:path";
import { defaultProtocolMarkdown, defaultProtocolYaml } from "../protocol/defaultProtocol.js";
import { resolveExistingDirectory } from "../safety/pathSafety.js";
import { nowIso } from "../utils/time.js";
import { ensureAgentWorkspace } from "../workspace/agentWorkspace.js";

export type InitWorkflowInput = {
  vaultPath: string;
};

export type InitWorkflowResult = {
  vaultPath: string;
  agentPath: string;
  created: string[];
};

export async function runInitWorkflow(input: InitWorkflowInput): Promise<InitWorkflowResult> {
  const vaultPath = await resolveExistingDirectory(input.vaultPath);
  const workspace = await ensureAgentWorkspace(vaultPath);
  const created: string[] = [];

  if (await writeIfMissing(workspace.protocolPath, defaultProtocolMarkdown)) {
    created.push(path.relative(vaultPath, workspace.protocolPath));
  }

  if (await writeIfMissing(workspace.protocolYamlPath, defaultProtocolYaml)) {
    created.push(path.relative(vaultPath, workspace.protocolYamlPath));
  }

  const logPath = path.join(workspace.logsDir, "init.log");
  await fs.appendFile(logPath, `${nowIso()} initialized apothecary-agent workspace\n`, "utf8");

  return {
    vaultPath,
    agentPath: workspace.rootPath,
    created,
  };
}

async function writeIfMissing(filePath: string, content: string): Promise<boolean> {
  const exists = await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);

  if (exists) return false;

  await fs.writeFile(filePath, content, "utf8");
  return true;
}
