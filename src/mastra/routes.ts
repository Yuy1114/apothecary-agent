import { promises as fs } from "node:fs";
import path from "node:path";
import type { ContextWithMastra } from "@mastra/core/server";

import { vaultReviewer } from "./agents/vault-reviewer.js";
import { queryVault, indexVault, reindexFile } from "../rag/vectorStore.js";
import { resolveExistingDirectory } from "../safety/pathSafety.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

// ── Helpers ──

function toPortablePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isMarkdownPath(p: string): boolean {
  return p.endsWith(".md");
}

function ensureMarkdownPath(p: string): void {
  if (!isMarkdownPath(p))
    throw Object.assign(new Error("Only .md files can be edited"), { statusCode: 400 });
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

// ── Route handlers ──

export async function handleHealth(c: ContextWithMastra) {
  const vaultPath = await resolveExistingDirectory(VAULT_PATH);
  return c.json({ status: "ok", vaultPath });
}

export async function handleVaultTree(c: ContextWithMastra) {
  const vaultPath = await resolveExistingDirectory(VAULT_PATH);
  const tree = await listVaultTree(vaultPath, "");
  return c.json({ root: vaultPath, tree });
}

export async function handleReadFile(c: ContextWithMastra) {
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

export async function handleWriteFile(c: ContextWithMastra) {
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

export async function handleRagQuery(c: ContextWithMastra) {
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

export async function handleReindex(c: ContextWithMastra) {
  indexVault()
    .then((result) => console.log(`Reindex complete: ${result.indexed} chunks`))
    .catch((err) => console.error("Reindex failed:", err));
  return c.json({ message: "Reindex queued" });
}
