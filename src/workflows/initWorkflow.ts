import path from "node:path";
import { appendTextArtifact, writeTextArtifactIfMissing } from "../artifacts/writeAgentArtifact.js";
import { defaultConfigYaml } from "../config/config.js";
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

  if (await writeTextArtifactIfMissing({ workspace, artifactPath: workspace.configPath, content: defaultConfigYaml })) {
    created.push(path.relative(vaultPath, workspace.configPath));
  }

  if (await writeTextArtifactIfMissing({ workspace, artifactPath: workspace.protocolPath, content: defaultProtocolMarkdown })) {
    created.push(path.relative(vaultPath, workspace.protocolPath));
  }

  if (await writeTextArtifactIfMissing({ workspace, artifactPath: workspace.protocolYamlPath, content: defaultProtocolYaml })) {
    created.push(path.relative(vaultPath, workspace.protocolYamlPath));
  }

  const logPath = path.join(workspace.logsDir, "init.log");
  await appendTextArtifact({ workspace, artifactPath: logPath, content: `${nowIso()} initialized apothecary-agent workspace\n` });

  return {
    vaultPath,
    agentPath: workspace.rootPath,
    created,
  };
}
