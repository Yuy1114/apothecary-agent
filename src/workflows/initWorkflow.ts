import path from "node:path";
import { promises as fs } from "node:fs";
import { appendTextArtifact, writeTextArtifactIfMissing } from "../artifacts/writeAgentArtifact.js";
import { defaultConfigYaml } from "../config/config.js";
import { defaultProtocolMarkdown, defaultProtocolYaml } from "../protocol/defaultProtocol.js";
import { resolveExistingDirectory } from "../safety/pathSafety.js";
import { nowIso } from "../utils/time.js";
import { ensureAgentWorkspace } from "../workspace/agentWorkspace.js";

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

  // Write vault structure config
  const structurePath = path.join(workspace.rootPath, "structure.yaml");
  const structureExists = await fs.access(structurePath).then(() => true).catch(() => false);
  if (!structureExists) {
    await fs.writeFile(structurePath, defaultStructureYaml, "utf8");
    created.push(path.relative(vaultPath, structurePath));
  }

  const logPath = path.join(workspace.logsDir, "init.log");
  await appendTextArtifact({ workspace, artifactPath: logPath, content: `${nowIso()} initialized apothecary-agent workspace\n` });

  return {
    vaultPath,
    agentPath: workspace.rootPath,
    created,
  };
}
