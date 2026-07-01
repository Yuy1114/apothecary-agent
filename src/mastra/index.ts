import "dotenv/config";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { registerApiRoute, type ContextWithMastra } from "@mastra/core/server";
import { promises as fs } from "node:fs";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

import { scanVaultTool, readMarkdownTool, writeReviewTool } from "../agent/tools.js";
import { queryVaultTool } from "../agent/queryVaultTool.js";
import { proposeEditTool } from "../agent/proposeEditTool.js";
import { ingestVaultTool } from "../agent/ingestVaultTool.js";
import { moveVaultFileTool } from "../agent/moveVaultFileTool.js";
import { queryVault, indexVault, reindexFile, removeFromIndex } from "../rag/chromaStore.js";
import { resolveExistingDirectory } from "../safety/pathSafety.js";

// ── Paths ──

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";
const DB_PATH = `file:${path.join(VAULT_PATH, ".agent", "memory.db")}`;

// ── Model provider (DeepSeek) ──

const deepseek = createOpenAICompatible({
  name: "deepseek",
  baseURL: (process.env.APOTHECARY_OPENAI_BASE_URL ?? "https://api.deepseek.com") + "/v1",
  apiKey: process.env.APOTHECARY_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
});

// ── Memory (LibSQL) ──

const memory = new Memory({
  storage: new LibSQLStore({ id: "apothecary-memory", url: DB_PATH }),
  options: {
    lastMessages: 20,
    observationalMemory: true,
  },
});

// ── Agent ──

export const vaultReviewer = new Agent({
  id: "vault-reviewer",
  name: "Vault Reviewer",
  description:
    "Read-only vault reviewer that produces knowledge maps, maintenance reviews, answers questions, and proposes edits.",
  instructions:
    "You are apothecary-agent, a personal knowledge maintenance assistant for Yuy's vault. " +
    "Use tools to scan, read, search, review, and propose edits. " +
    "Answer in Chinese when the user writes Chinese. Be concise.",
  model: deepseek("deepseek-chat"),
  memory,
  tools: {
    scanVault: scanVaultTool,
    readMarkdown: readMarkdownTool,
    writeReview: writeReviewTool,
    queryVault: queryVaultTool,
    proposeEdit: proposeEditTool,
    ingestVault: ingestVaultTool,
    moveVaultFile: moveVaultFileTool,
  },
});

// ── Utility helpers ──

function toPortablePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isMarkdownPath(p: string): boolean {
  return p.endsWith(".md");
}

function ensureMarkdownPath(p: string): void {
  if (!isMarkdownPath(p)) throw Object.assign(new Error("Only .md files can be edited"), { statusCode: 400 });
}

// ── File watcher ──

let watcher: FSWatcher | null = null;

function startVaultWatcher(): void {
  if (watcher) return;
  try {
    watcher = watch(VAULT_PATH, { recursive: true }, (_eventType, filename) => {
      const relativePath = toPortablePath(filename ?? "");
      if (!relativePath || relativePath.startsWith(".")) return;
      if (!isMarkdownPath(relativePath)) return;
      const absolutePath = path.join(VAULT_PATH, relativePath);
      fs.stat(absolutePath)
        .then((stat) => {
          if (stat.isFile()) {
            reindexFile(relativePath).catch(() => {});
          } else {
            removeFromIndex(relativePath).catch(() => {});
          }
        })
        .catch(() => removeFromIndex(relativePath).catch(() => {}));
    });
    console.log("Vault watcher started");
  } catch {
    console.warn("Vault watcher failed to start");
  }
}

// ── Vault tree ──

type VaultTreeNode = {
  name: string;
  path: string;
  type: "directory" | "file";
  children?: VaultTreeNode[];
};

async function listVaultTree(root: string, relativeDir: string): Promise<VaultTreeNode[]> {
  const absoluteDir = path.join(root, relativeDir);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const nodes = await Promise.all(
    entries
      .filter((e) => !e.name.startsWith("."))
      .map(async (entry): Promise<VaultTreeNode | null> => {
        const relPath = toPortablePath(path.join(relativeDir, entry.name));
        if (entry.isDirectory()) {
          return { name: entry.name, path: relPath, type: "directory", children: await listVaultTree(root, relPath) };
        }
        if (entry.isFile() && isMarkdownPath(entry.name)) {
          return { name: entry.name, path: relPath, type: "file" };
        }
        return null;
      }),
  );
  return nodes.filter((n): n is VaultTreeNode => n !== null);
}

// ── API route handlers ──

async function handleHealth(c: ContextWithMastra) {
  const vaultPath = await resolveExistingDirectory(VAULT_PATH);
  return c.json({ status: "ok", vaultPath });
}

async function handleVaultTree(c: ContextWithMastra) {
  const vaultPath = await resolveExistingDirectory(VAULT_PATH);
  const tree = await listVaultTree(vaultPath, "");
  return c.json({ root: vaultPath, tree });
}

async function handleReadFile(c: ContextWithMastra) {
  const vaultPath = await resolveExistingDirectory(VAULT_PATH);
  const relativePath = c.req.query("path");
  if (!relativePath) return c.json({ message: "path query parameter required" }, 400);
  const absolutePath = path.join(vaultPath, relativePath);
  if (!absolutePath.startsWith(vaultPath)) return c.json({ message: "path escapes vault" }, 403);

  const [content, stat] = await Promise.all([fs.readFile(absolutePath, "utf8"), fs.stat(absolutePath)]);
  return c.json({
    path: toPortablePath(path.relative(vaultPath, absolutePath)),
    content,
    updatedAt: stat.mtime.toISOString(),
  });
}

async function handleWriteFile(c: ContextWithMastra) {
  const vaultPath = await resolveExistingDirectory(VAULT_PATH);
  const body = (await c.req.json()) as { path?: string; content?: string };
  if (!body.path || typeof body.content !== "string") {
    return c.json({ message: "path/content 不能为空" }, 400);
  }

  const absolutePath = path.join(vaultPath, body.path);
  if (!absolutePath.startsWith(vaultPath)) return c.json({ message: "path escapes vault" }, 403);
  ensureMarkdownPath(absolutePath);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, body.content, "utf8");

  const relativePath = toPortablePath(path.relative(vaultPath, absolutePath));
  reindexFile(relativePath).catch(() => {});

  const stat = await fs.stat(absolutePath);
  return c.json({
    file: { path: relativePath, content: body.content, updatedAt: stat.mtime.toISOString(), saved: true },
  });
}

async function handleRagQuery(c: ContextWithMastra) {
  const body = (await c.req.json()) as { query?: string; topK?: number };
  const query = body.query?.trim();
  if (!query) return c.json({ message: "query 不能为空" }, 400);

  const sources = await queryVault(query, body.topK ?? 5);

  if (sources.length === 0) {
    return c.json({
      query,
      answer: "没有在当前索引中检索到相关内容。请先重建索引。",
      sources: [],
      threadId: "rag-web",
    });
  }

  const prompt =
    `Question: ${query}\n\n` +
    "Retrieved vault evidence JSON:\n" +
    JSON.stringify(sources.map((s, i) => ({ index: i + 1, ...s })), null, 2) +
    "\n\nAnswer from this evidence. Include a short '参考文件' list.";

  const result = await vaultReviewer.generate(prompt, {
    maxSteps: 2,
    memory: { resource: "yuy", thread: "rag-web" },
  });

  return c.json({ query, answer: result.text, sources, threadId: "rag-web" });
}

async function handleReindex(c: ContextWithMastra) {
  indexVault()
    .then((result) => console.log(`Reindex complete: ${result.indexed} chunks`))
    .catch((err) => console.error("Reindex failed:", err));
  return c.json({ message: "Reindex queued" });
}

// ── Mastra instance ──

export const mastra = new Mastra({
  agents: { vaultReviewer },
  storage: new LibSQLStore({ id: "apothecary-storage", url: DB_PATH }),
  server: {
    port: Number(process.env.APOTHECARY_UI_PORT ?? 8787),
    apiRoutes: [
      registerApiRoute("/health", { method: "GET", handler: handleHealth }),
      registerApiRoute("/vault/tree", { method: "GET", handler: handleVaultTree }),
      registerApiRoute("/vault/files", { method: "GET", handler: handleReadFile }),
      registerApiRoute("/vault/files", { method: "PUT", handler: handleWriteFile }),
      registerApiRoute("/rag/query", { method: "POST", handler: handleRagQuery }),
      registerApiRoute("/index", { method: "POST", handler: handleReindex }),
    ],
  },
});

// ── Start file watcher on server boot ──

startVaultWatcher();
