import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import path from "node:path";
import { promises as fs } from "node:fs";
import { appendTextArtifact, writeTextArtifactIfMissing } from "../../artifacts/writeAgentArtifact.js";
import { defaultVaultAgentConfigYaml } from "../../config/vaultAgentConfig.js";
import { defaultProtocolMarkdown, defaultProtocolYaml } from "../../protocol/defaultProtocol.js";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { nowIso } from "../../utils/time.js";
import { ensureAgentArtifacts } from "../../artifacts/agentArtifacts.js";

const defaultStructureYaml = `# apothecary-agent vault structure
# Edit this file to define your vault layout.
# The agent uses it to classify and place ingested content.

directories:
  inbox/:
    description: "临时未归类，待整理"
    
  notes/programming/Java/:
    description: "Java 后端 — Spring Boot, MyBatis, JVM, 微服务"
    keywords: [java, spring, mybatis, jvm, rabbitmq, websocket, 微服务]
    
  notes/programming/Redis/:
    description: "Redis — 缓存、持久化、集群"
    keywords: [redis, 缓存, 持久化, rdb, aof]
    
  notes/programming/React/:
    description: "React 前端"
    keywords: [react, 前端, vite, swr, jotai]
    
  notes/programming/JavaScript/:
    description: "JavaScript / TypeScript"
    keywords: [javascript, js, typescript, ts, dom]
    
  notes/programming/Data Structures & Algorithms/:
    description: "数据结构与算法"
    keywords: [算法, 数据结构, leetcode, 二叉树, 链表, 动态规划]
    
  career/:
    description: "求职 — 简历、面试、投递"
    keywords: [面试, 简历, 投递, 岗位, jd, 求职]
    
  projects/:
    description: "项目文档"
    keywords: [项目, agent, do-together, edu-flow, apothecary]
    
  reflections/:
    description: "反思、复盘、感想"
    keywords: [感想, 反思, 复盘, 总结]
`;

// ── Steps ──

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
    const artifacts = await ensureAgentArtifacts(inputData.vaultPath);
    return { vaultPath: inputData.vaultPath, agentPath: artifacts.rootPath };
  },
});

const writeConfigStep = createStep({
  id: "write-config",
  inputSchema: z.object({ vaultPath: z.string(), agentPath: z.string() }),
  outputSchema: z.object({ vaultPath: z.string(), agentPath: z.string(), created: z.array(z.string()) }),
  execute: async ({ inputData }) => {
    const artifacts = await ensureAgentArtifacts(inputData.vaultPath);
    const created: string[] = [];
    if (await writeTextArtifactIfMissing({ artifacts, artifactPath: artifacts.configPath, content: defaultVaultAgentConfigYaml })) {
      created.push(path.relative(inputData.vaultPath, artifacts.configPath));
    }
    return { ...inputData, created };
  },
});

const writeProtocolStep = createStep({
  id: "write-protocol",
  inputSchema: z.object({ vaultPath: z.string(), agentPath: z.string(), created: z.array(z.string()) }),
  outputSchema: z.object({ vaultPath: z.string(), agentPath: z.string(), created: z.array(z.string()) }),
  execute: async ({ inputData }) => {
    const artifacts = await ensureAgentArtifacts(inputData.vaultPath);
    const created = [...inputData.created];
    if (await writeTextArtifactIfMissing({ artifacts, artifactPath: artifacts.protocolPath, content: defaultProtocolMarkdown })) {
      created.push(path.relative(inputData.vaultPath, artifacts.protocolPath));
    }
    if (await writeTextArtifactIfMissing({ artifacts, artifactPath: artifacts.protocolYamlPath, content: defaultProtocolYaml })) {
      created.push(path.relative(inputData.vaultPath, artifacts.protocolYamlPath));
    }
    return { ...inputData, created };
  },
});

const writeStructureStep = createStep({
  id: "write-structure",
  inputSchema: z.object({ vaultPath: z.string(), agentPath: z.string(), created: z.array(z.string()) }),
  outputSchema: z.object({ vaultPath: z.string(), agentPath: z.string(), created: z.array(z.string()) }),
  execute: async ({ inputData }) => {
    const artifacts = await ensureAgentArtifacts(inputData.vaultPath);
    const created = [...inputData.created];
    const structurePath = path.join(artifacts.rootPath, "structure.yaml");
    const exists = await fs.access(structurePath).then(() => true).catch(() => false);
    if (!exists) {
      await fs.writeFile(structurePath, defaultStructureYaml, "utf8");
      created.push(path.relative(inputData.vaultPath, structurePath));
    }
    return { ...inputData, created };
  },
});

const writeLogStep = createStep({
  id: "write-log",
  inputSchema: z.object({ vaultPath: z.string(), agentPath: z.string(), created: z.array(z.string()) }),
  outputSchema: z.object({ vaultPath: z.string(), agentPath: z.string(), created: z.array(z.string()) }),
  execute: async ({ inputData }) => {
    const artifacts = await ensureAgentArtifacts(inputData.vaultPath);
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
  .then(writeStructureStep)
  .then(writeLogStep)
  .commit();
