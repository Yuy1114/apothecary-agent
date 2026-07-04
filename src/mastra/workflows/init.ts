import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import path from "node:path";
import { appendTextArtifact, writeTextArtifactIfMissing } from "../../artifacts/writeAgentArtifact.js";
import { defaultVaultAgentConfigYaml } from "../../config/vaultAgentConfig.js";
import { defaultCharterConfigYaml } from "../../config/charterConfig.js";
import { defaultProtocolMarkdown, defaultProtocolYaml } from "../../protocol/defaultProtocol.js";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { nowIso } from "../../utils/time.js";
import { ensureAgentArtifacts } from "../../artifacts/agentArtifacts.js";

// ── Steps ──
//
// The agent's home (`~/.apothecary`) is global and vault-independent, so init
// validates the target vault exists but writes all artifacts to the shared home.

const resolveVaultStep = createStep({
  id: "resolve-vault",
  inputSchema: z.object({ vaultPath: z.string() }),
  outputSchema: z.object({ vaultPath: z.string() }),
  execute: async ({ inputData }) => {
    const vaultPath = await resolveExistingDirectory(inputData.vaultPath);
    return { vaultPath };
  },
});

const ensureWorkspaceStep = createStep({
  id: "ensure-workspace",
  inputSchema: z.object({ vaultPath: z.string() }),
  outputSchema: z.object({ vaultPath: z.string(), agentPath: z.string() }),
  execute: async ({ inputData }) => {
    const artifacts = await ensureAgentArtifacts();
    return { vaultPath: inputData.vaultPath, agentPath: artifacts.rootPath };
  },
});

const writeConfigStep = createStep({
  id: "write-config",
  inputSchema: z.object({ vaultPath: z.string(), agentPath: z.string() }),
  outputSchema: z.object({ vaultPath: z.string(), agentPath: z.string(), created: z.array(z.string()) }),
  execute: async ({ inputData }) => {
    const artifacts = await ensureAgentArtifacts();
    const created: string[] = [];
    const rel = (p: string) => path.relative(artifacts.rootPath, p);
    // engine.yaml — technical runtime config (reviewer/scan/map/review).
    if (await writeTextArtifactIfMissing({ artifacts, artifactPath: artifacts.enginePath, content: defaultVaultAgentConfigYaml })) {
      created.push(rel(artifacts.enginePath));
    }
    // config.yaml — human charter (schedule/routing/protected/obsidian). Never
    // clobbered: a user-authored charter always wins.
    if (await writeTextArtifactIfMissing({ artifacts, artifactPath: artifacts.configPath, content: defaultCharterConfigYaml })) {
      created.push(rel(artifacts.configPath));
    }
    return { ...inputData, created };
  },
});

const writeProtocolStep = createStep({
  id: "write-protocol",
  inputSchema: z.object({ vaultPath: z.string(), agentPath: z.string(), created: z.array(z.string()) }),
  outputSchema: z.object({ vaultPath: z.string(), agentPath: z.string(), created: z.array(z.string()) }),
  execute: async ({ inputData }) => {
    const artifacts = await ensureAgentArtifacts();
    const created = [...inputData.created];
    const rel = (p: string) => path.relative(artifacts.rootPath, p);
    if (await writeTextArtifactIfMissing({ artifacts, artifactPath: artifacts.protocolPath, content: defaultProtocolMarkdown })) {
      created.push(rel(artifacts.protocolPath));
    }
    if (await writeTextArtifactIfMissing({ artifacts, artifactPath: artifacts.protocolYamlPath, content: defaultProtocolYaml })) {
      created.push(rel(artifacts.protocolYamlPath));
    }
    return { ...inputData, created };
  },
});

const writeLogStep = createStep({
  id: "write-log",
  inputSchema: z.object({ vaultPath: z.string(), agentPath: z.string(), created: z.array(z.string()) }),
  outputSchema: z.object({ vaultPath: z.string(), agentPath: z.string(), created: z.array(z.string()) }),
  execute: async ({ inputData }) => {
    const artifacts = await ensureAgentArtifacts();
    const logPath = path.join(artifacts.logsDir, "init.log");
    await appendTextArtifact({ artifacts, artifactPath: logPath, content: `${nowIso()} initialized apothecary-agent workspace\n` });
    return inputData;
  },
});

// ── Workflow ──

export const initWorkflow = createWorkflow({
  id: "init",
  inputSchema: z.object({ vaultPath: z.string() }),
  outputSchema: z.object({ vaultPath: z.string(), agentPath: z.string(), created: z.array(z.string()) }),
})
  .then(resolveVaultStep)
  .then(ensureWorkspaceStep)
  .then(writeConfigStep)
  .then(writeProtocolStep)
  .then(writeLogStep)
  .commit();
