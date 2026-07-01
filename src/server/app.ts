import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createReviewerModel } from "../reviewer/createReviewerModel.js";
import type { MastraReviewerModel } from "../agent/mastraReviewerModel.js";
import { loadConfig } from "../config/config.js";
import { ensureAgentWorkspace } from "../workspace/agentWorkspace.js";
import { resolveExistingDirectory } from "../safety/pathSafety.js";
import { queryVault } from "../rag/chromaStore.js";
import {
  AppDatabase,
  type ActivityEventRecord,
  type ActivityType,
  type ConversationMessageRecord,
  type MemoryCandidateRecord,
} from "../storage/appDatabase.js";
import { SyncCoordinator } from "../sync/syncCoordinator.js";

type VaultTreeNode = {
  name: string;
  path: string;
  type: "directory" | "file";
  children?: VaultTreeNode[];
};

type AppContext = {
  vaultPath: string;
  reviewer: MastraReviewerModel;
  appDb: AppDatabase;
  sseClients: Set<ServerResponse>;
  watcher: FSWatcher | null;
  jobs: JobState[];
  sync: SyncCoordinator;
};

type JobState = {
  id: string;
  title: string;
  description: string;
  status: "idle" | "running" | "failed";
  lastRunAt: string | null;
  lastResult: string | null;
};

const WEB_ROOT = path.resolve(process.cwd(), "web");
const CHAT_SYSTEM = [
  "You are apothecary-agent, Yuy's personal knowledge maintenance assistant.",
  "Answer in Chinese when the user writes Chinese.",
  "Use the provided retrieved vault evidence as your source of truth.",
  "Be concise and explicitly mention which files/heading breadcrumbs supported the answer.",
].join("\n");
const DEFAULT_THREAD_ID = "web-chat";

export async function startApothecaryServer(options: { port?: number; vaultPath?: string } = {}): Promise<void> {
  if (options.vaultPath) process.env.APOTHECARY_VAULT_PATH = options.vaultPath;

  const vaultPath = await resolveExistingDirectory(
    process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault",
  );
  const workspace = await ensureAgentWorkspace(vaultPath);
  const config = await loadConfig(workspace);
  const reviewer = createReviewerModel(config) as MastraReviewerModel;
  const appDb = await AppDatabase.open(vaultPath);
  const sseClients = new Set<ServerResponse>();
  const sync = new SyncCoordinator({
    vaultPath,
    appDb,
    onEvent: (event) => {
      const type: ActivityType = event.type === "failed" ? "error" : "index";
      const activity = appDb.recordActivity({ type, message: event.message, path: event.path });
      const payload = `data: ${JSON.stringify(activity)}\n\n`;
      for (const client of sseClients) client.write(payload);
    },
  });
  const ctx: AppContext = {
    vaultPath,
    reviewer,
    appDb,
    sseClients,
    sync,
    watcher: null,
    jobs: [
      {
        id: "reindex-vault",
        title: "Reindex Vault",
        description: "重建 RAG 索引，让新增/修改内容可检索。",
        status: "idle",
        lastRunAt: null,
        lastResult: null,
      },
    ],
  };

  logActivity(ctx, "server", `Apothecary UI connected to ${vaultPath}`);
  startVaultWatcher(ctx);

  const server = createServer((request, response) => {
    handleRequest(ctx, request, response).catch((error: unknown) => {
      sendJson(response, getStatusCode(error), {
        message: error instanceof Error ? error.message : String(error),
      });
      logActivity(ctx, "error", error instanceof Error ? error.message : String(error));
    });
  });

  const port = options.port ?? Number(process.env.APOTHECARY_UI_PORT ?? 8787);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${port}`;
  console.log(`apothecary-agent UI: ${url}`);
  console.log(`vault: ${vaultPath}`);

  const shutdown = () => {
    ctx.watcher?.close();
    for (const client of ctx.sseClients) client.end();
    ctx.appDb.close();
    server.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function handleRequest(ctx: AppContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "OPTIONS") {
    sendCors(response);
    response.statusCode = 204;
    response.end();
    return;
  }

  if (url.pathname === "/api/events" && request.method === "GET") {
    handleEventStream(ctx, response);
    return;
  }

  if (url.pathname === "/api/health" && request.method === "GET") {
    sendJson(response, 200, { status: "ok", vaultPath: ctx.vaultPath, appDbPath: ctx.appDb.path });
    return;
  }

  if (url.pathname === "/api/activity" && request.method === "GET") {
    sendJson(response, 200, { activities: ctx.appDb.listActivity(100) });
    return;
  }

  if (url.pathname === "/api/conversations/threads" && request.method === "GET") {
    ctx.appDb.ensureConversationThread({ id: DEFAULT_THREAD_ID, title: "Web Chat" });
    sendJson(response, 200, { threads: ctx.appDb.listConversationThreads(50) });
    return;
  }

  if (url.pathname === "/api/conversations/messages" && request.method === "GET") {
    const threadId = url.searchParams.get("threadId") ?? DEFAULT_THREAD_ID;
    ctx.appDb.ensureConversationThread({ id: threadId, title: "Web Chat" });
    sendJson(response, 200, {
      threadId,
      summary: ctx.appDb.getLatestConversationSummary(threadId),
      messages: ctx.appDb.listConversationMessages(threadId, 100),
    });
    return;
  }

  if (url.pathname === "/api/memory-candidates" && request.method === "GET") {
    const status = url.searchParams.get("status") ?? "proposed";
    if (!isMemoryCandidateStatus(status)) throw badRequest("invalid memory candidate status");
    sendJson(response, 200, { candidates: ctx.appDb.listMemoryCandidates(status, 100) });
    return;
  }

  const memoryCandidateMatch = url.pathname.match(/^\/api\/memory-candidates\/(\d+)$/);
  if (memoryCandidateMatch && request.method === "PATCH") {
    const body = await readJsonBody<{ status?: string }>(request);
    if (!body.status || body.status === "all" || !isMemoryCandidateStatus(body.status)) throw badRequest("invalid memory candidate status");
    const candidate = ctx.appDb.updateMemoryCandidateStatus(Number(memoryCandidateMatch[1]), body.status as MemoryCandidateRecord["status"]);
    logActivity(ctx, "memory", `Memory candidate ${candidate.id} marked ${candidate.status}`);
    sendJson(response, 200, { candidate });
    return;
  }

  const memoryCandidateWriteMatch = url.pathname.match(/^\/api\/memory-candidates\/(\d+)\/write$/);
  if (memoryCandidateWriteMatch && request.method === "POST") {
    const result = await writeMemoryCandidateToVault(ctx, Number(memoryCandidateWriteMatch[1]));
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname === "/api/vault/tree" && request.method === "GET") {
    sendJson(response, 200, { root: ctx.vaultPath, tree: await listVaultTree(ctx.vaultPath, "") });
    return;
  }

  if (url.pathname === "/api/vault/files" && request.method === "GET") {
    const relativePath = getRequiredQuery(url, "path");
    const absolutePath = resolveVaultPath(ctx.vaultPath, relativePath);
    const [content, stat] = await Promise.all([fs.readFile(absolutePath, "utf8"), fs.stat(absolutePath)]);
    sendJson(response, 200, { path: toPortablePath(path.relative(ctx.vaultPath, absolutePath)), content, updatedAt: stat.mtime.toISOString() });
    return;
  }

  if (url.pathname === "/api/vault/files" && request.method === "PUT") {
    const body = await readJsonBody<{ path?: string; content?: unknown }>(request);
    if (!body.path || typeof body.content !== "string") throw badRequest("path/content 不能为空");
    const absolutePath = resolveVaultPath(ctx.vaultPath, body.path);
    ensureMarkdownPath(absolutePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, body.content, "utf8");
    const relativePath = toPortablePath(path.relative(ctx.vaultPath, absolutePath));
    const syncJob = await ctx.sync.enqueueFileChanged(relativePath);
    logActivity(ctx, "file", `Saved ${relativePath}; sync job ${syncJob.id} queued`, relativePath);
    const stat = await fs.stat(absolutePath);
    sendJson(response, 200, { file: { path: relativePath, content: body.content, updatedAt: stat.mtime.toISOString(), saved: true }, syncJob });
    return;
  }

  if (url.pathname === "/api/rag/query" && request.method === "POST") {
    const body = await readJsonBody<{ query?: string; topK?: number; threadId?: string }>(request);
    const query = body.query?.trim();
    if (!query) throw badRequest("query 不能为空");
    const threadId = body.threadId?.trim() || DEFAULT_THREAD_ID;
    const userMessage = ctx.appDb.appendConversationMessage({ threadId, role: "user", content: query });
    const sources = await queryVault(query, body.topK ?? 5);
    const answer = await generateAnswer(ctx, threadId, query, sources);
    const assistantMessage = ctx.appDb.appendConversationMessage({
      threadId,
      role: "assistant",
      content: answer,
      metadata: { sources },
    });
    const summary = refreshConversationSummary(ctx, threadId);
    const candidates = proposeMemoryCandidates(ctx, threadId, userMessage, query, answer);
    sendJson(response, 200, { query, answer, sources, threadId, messages: [userMessage, assistantMessage], summary, memoryCandidates: candidates });
    return;
  }

  if (url.pathname === "/api/index" && request.method === "POST") {
    const syncJob = ctx.sync.enqueueVaultReindex();
    sendJson(response, 200, { syncJob });
    return;
  }

  if (url.pathname === "/api/sync" && request.method === "GET") {
    sendJson(response, 200, { status: ctx.appDb.getSyncStatus(), jobs: ctx.appDb.listSyncJobs(100) });
    return;
  }

  if (url.pathname === "/api/sync/run" && request.method === "POST") {
    await ctx.sync.runPendingJobs();
    sendJson(response, 200, { status: ctx.appDb.getSyncStatus(), jobs: ctx.appDb.listSyncJobs(100) });
    return;
  }

  if (url.pathname === "/api/jobs" && request.method === "GET") {
    sendJson(response, 200, { jobs: ctx.jobs });
    return;
  }

  const jobRunMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/run$/);
  if (jobRunMatch && request.method === "POST") {
    const result = await runJob(ctx, jobRunMatch[1]);
    sendJson(response, 200, { job: result });
    return;
  }

  await serveStatic(url.pathname, response);
}

async function generateAnswer(ctx: AppContext, threadId: string, query: string, sources: Awaited<ReturnType<typeof queryVault>>): Promise<string> {
  if (sources.length === 0) return "没有在当前索引中检索到相关内容。可以先点击 Reindex Vault 重建索引。";

  const summary = ctx.appDb.getLatestConversationSummary(threadId);

  const prompt =
    `Question: ${query}\n\n` +
    (summary ? `Current conversation summary:\n${summary.summary}\n\n` : "") +
    "Retrieved vault evidence JSON:\n" +
    JSON.stringify(sources.map((source, index) => ({ index: index + 1, ...source })), null, 2) +
    "\n\nAnswer from this evidence. Include a short '参考文件' list.";

  const result = await ctx.reviewer.rawAgent.generate(prompt, {
    maxSteps: 2,
    system: CHAT_SYSTEM,
    memory: { resource: "yuy", thread: threadId },
  });
  logActivity(ctx, "server", `Answered RAG query: ${query}`);
  return result.text;
}

function refreshConversationSummary(ctx: AppContext, threadId: string): ReturnType<AppDatabase["createConversationSummary"]> | null {
  const messages = ctx.appDb.listConversationMessages(threadId, 12);
  if (messages.length < 2) return null;

  const first = messages[0];
  const last = messages[messages.length - 1];
  const summary = messages
    .map((message) => `${message.role}: ${message.content.replace(/\s+/g, " ").slice(0, 220)}`)
    .join("\n");

  return ctx.appDb.createConversationSummary({
    threadId,
    summary: `最近对话摘要（自动生成，非知识源）：\n${summary}`,
    coveredMessageIdFrom: first.id,
    coveredMessageIdTo: last.id,
  });
}

function proposeMemoryCandidates(
  ctx: AppContext,
  threadId: string,
  sourceMessage: ConversationMessageRecord,
  query: string,
  answer: string,
): MemoryCandidateRecord[] {
  const candidates: MemoryCandidateRecord[] = [];
  const combined = `${query}\n${answer}`;
  if (!looksLikeDurableMemory(combined)) return candidates;

  const target = combined.includes("我") || combined.includes("偏好") || combined.includes("叫")
    ? "user_memory"
    : combined.includes("vault") || combined.includes("Markdown") || combined.includes("Chroma") || combined.includes("SQLite")
      ? "project_memory"
      : "vault_note";

  const content = summarizeMemoryCandidate(query, answer);
  const candidate = ctx.appDb.upsertMemoryCandidate({
    threadId,
    sourceMessageId: sourceMessage.id,
    content,
    reason: "对话中出现了稳定偏好、架构边界或可沉淀知识；先作为候选，等待 Yuy 确认。",
    target,
  });
  logActivity(ctx, "memory", `Proposed memory candidate ${candidate.id}: ${candidate.target}`);
  candidates.push(candidate);

  return candidates;
}

function looksLikeDurableMemory(text: string): boolean {
  return ["以后", "必须", "默认", "偏好", "记住", "边界", "架构", "source of truth", "SQLite", "Chroma", "Markdown", "Mastra memory"]
    .some((keyword) => text.includes(keyword));
}

function summarizeMemoryCandidate(query: string, answer: string): string {
  const compactQuery = query.replace(/\s+/g, " ").trim();
  const compactAnswer = answer.replace(/\s+/g, " ").trim();
  const candidate = compactAnswer.length > 360 ? compactAnswer.slice(0, 360) + "…" : compactAnswer;
  return `Q: ${compactQuery}\nA: ${candidate}`;
}

async function writeMemoryCandidateToVault(ctx: AppContext, candidateId: number): Promise<{
  candidate: MemoryCandidateRecord;
  proposal: ReturnType<AppDatabase["createProposal"]>;
  file: { path: string; content: string };
  syncJob: Awaited<ReturnType<SyncCoordinator["enqueueFileChanged"]>>;
}> {
  const originalCandidate = ctx.appDb.getMemoryCandidateById(candidateId);
  const candidate = originalCandidate.status === "accepted"
    ? originalCandidate
    : ctx.appDb.updateMemoryCandidateStatus(candidateId, "accepted");
  const relativePath = getMemoryTargetPath(candidate);
  const absolutePath = resolveVaultPath(ctx.vaultPath, relativePath);
  const entry = formatMemoryCandidateMarkdown(candidate);
  const currentContent = await fs.readFile(absolutePath, "utf8").catch(() => "");
  const content = currentContent.trim()
    ? `${currentContent.trimEnd()}\n\n${entry}`
    : `# ${getMemoryTargetTitle(candidate)}\n\n${entry}`;

  const proposal = ctx.appDb.createProposal({
    type: "write_memory_candidate",
    title: `Write memory candidate ${candidate.id}`,
    reason: candidate.reason,
    operations: {
      kind: "append_memory_note",
      candidateId: candidate.id,
      targetPath: relativePath,
      content: entry,
    },
  });

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
  const syncJob = await ctx.sync.enqueueFileChanged(relativePath);

  const writtenCandidate = ctx.appDb.updateMemoryCandidateStatus(candidate.id, "written");
  const appliedProposal = ctx.appDb.updateProposalStatus(proposal.id, "applied");
  logActivity(ctx, "memory", `Wrote memory candidate ${candidate.id} to ${relativePath}; sync job ${syncJob.id} queued`, relativePath);

  return { candidate: writtenCandidate, proposal: appliedProposal, file: { path: relativePath, content }, syncJob };
}

function getMemoryTargetPath(candidate: MemoryCandidateRecord): string {
  if (candidate.target === "user_memory") return "personal/preferences.md";
  if (candidate.target === "project_memory") return "projects/apothecary-agent/memory.md";
  return "notes/conversation-memory.md";
}

function getMemoryTargetTitle(candidate: MemoryCandidateRecord): string {
  if (candidate.target === "user_memory") return "Personal Preferences";
  if (candidate.target === "project_memory") return "apothecary-agent Memory";
  return "Conversation Memory";
}

function formatMemoryCandidateMarkdown(candidate: MemoryCandidateRecord): string {
  return [
    `## Memory Candidate ${candidate.id}`,
    "",
    `- Target: ${candidate.target}`,
    `- Source thread: ${candidate.threadId ?? "unknown"}`,
    `- Created: ${candidate.createdAt}`,
    `- Reason: ${candidate.reason}`,
    "",
    candidate.content,
  ].join("\n");
}

function startVaultWatcher(ctx: AppContext): void {
  try {
    ctx.watcher = watch(ctx.vaultPath, { recursive: true }, (eventType, filename) => {
      const relativePath = normalizeWatchPath(filename);
      if (!relativePath || shouldIgnorePath(relativePath)) return;
      logActivity(ctx, "file", `${eventType}: ${relativePath}`, relativePath);
      if (!isMarkdownPath(relativePath)) return;
      void syncChangedFile(ctx, relativePath);
    });
    ctx.watcher.on("error", (error) => logActivity(ctx, "error", `Vault watcher failed: ${error.message}`));
    logActivity(ctx, "server", "Vault watcher started");
  } catch (error) {
    logActivity(ctx, "error", `Vault watcher failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function syncChangedFile(ctx: AppContext, relativePath: string): Promise<void> {
  const absolutePath = path.join(ctx.vaultPath, relativePath);
  try {
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (stat?.isFile()) {
      await ctx.sync.enqueueFileChanged(relativePath);
    } else {
      ctx.sync.enqueueFileDeleted(relativePath);
    }
  } catch (error) {
    ctx.appDb.markFileError({ path: relativePath, errorMessage: error instanceof Error ? error.message : String(error) });
    logActivity(ctx, "error", `Failed to queue sync for ${relativePath}: ${error instanceof Error ? error.message : String(error)}`, relativePath);
  }
}

async function runJob(ctx: AppContext, jobId: string): Promise<JobState> {
  const job = ctx.jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw notFound("job 不存在");
  job.status = "running";
  logActivity(ctx, "job", `${job.title} started`);
  try {
    const syncJob = ctx.sync.enqueueVaultReindex();
    await ctx.sync.runPendingJobs();
    job.status = "idle";
    job.lastRunAt = new Date().toISOString();
    job.lastResult = `sync job ${syncJob.id} queued`;
    logActivity(ctx, "job", `${job.title} finished: ${job.lastResult}`);
  } catch (error) {
    job.status = "failed";
    job.lastRunAt = new Date().toISOString();
    job.lastResult = error instanceof Error ? error.message : String(error);
    logActivity(ctx, "error", `${job.title} failed: ${job.lastResult}`);
  }
  return job;
}

function logActivity(ctx: AppContext, type: ActivityType, message: string, eventPath?: string): ActivityEventRecord {
  const event = ctx.appDb.recordActivity({ type, message, path: eventPath });
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of ctx.sseClients) client.write(payload);
  return event;
}

function handleEventStream(ctx: AppContext, response: ServerResponse): void {
  sendCors(response);
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  ctx.sseClients.add(response);
  for (const event of ctx.appDb.listActivity(20).reverse()) response.write(`data: ${JSON.stringify(event)}\n\n`);
  response.on("close", () => ctx.sseClients.delete(response));
}

async function listVaultTree(root: string, relativeDirectory: string): Promise<VaultTreeNode[]> {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  const nodes = await Promise.all(entries
    .filter((entry) => !entry.name.startsWith("."))
    .map(async (entry): Promise<VaultTreeNode | null> => {
      const relativePath = toPortablePath(path.join(relativeDirectory, entry.name));
      const absolutePath = path.join(root, relativePath);
      if (entry.isDirectory()) {
        return { name: entry.name, path: relativePath, type: "directory", children: await listVaultTree(root, relativePath) };
      }
      if (!entry.isFile() || !isMarkdownPath(absolutePath)) return null;
      return { name: entry.name, path: relativePath, type: "file" };
    }));

  return nodes
    .filter((node): node is VaultTreeNode => node !== null)
    .sort((left, right) => left.type === right.type ? left.name.localeCompare(right.name) : left.type === "directory" ? -1 : 1);
}

async function serveStatic(requestPath: string, response: ServerResponse): Promise<void> {
  const cleanPath = requestPath === "/" ? "/index.html" : requestPath;
  const absolutePath = path.resolve(WEB_ROOT, cleanPath.replace(/^\/+/, ""));
  if (!absolutePath.startsWith(WEB_ROOT)) throw badRequest("invalid static path");

  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) throw notFound("not found");
    response.writeHead(200, { "Content-Type": getContentType(absolutePath) });
    response.end(await fs.readFile(absolutePath));
  } catch {
    const fallback = path.join(WEB_ROOT, "index.html");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(await fs.readFile(fallback));
  }
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  sendCors(response);
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendCors(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,OPTIONS");
}

function resolveVaultPath(root: string, inputPath: string): string {
  const normalizedInput = inputPath.replaceAll("\\", "/").replace(/^\/+/, "");
  const absolutePath = path.resolve(root, normalizedInput);
  const relativePath = path.relative(root, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) throw badRequest("path 必须位于 vault 内");
  ensureMarkdownPath(absolutePath);
  return absolutePath;
}

function ensureMarkdownPath(filePath: string): void {
  if (!isMarkdownPath(filePath)) throw badRequest("只支持 Markdown 文件");
}

function isMarkdownPath(filePath: string): boolean {
  return [".md", ".markdown"].includes(path.extname(filePath).toLowerCase());
}

function normalizeWatchPath(filename: string | Buffer | null): string | null {
  if (!filename) return null;
  const rawPath = Buffer.isBuffer(filename) ? filename.toString("utf8") : filename;
  return toPortablePath(rawPath).replace(/^\/+/, "") || null;
}

function shouldIgnorePath(relativePath: string): boolean {
  const segments = relativePath.split("/").filter(Boolean).map((segment) => segment.toLowerCase());
  if (segments.some((segment) => [".agent", ".apothecary", ".obsidian", "node_modules", ".git"].includes(segment))) return true;
  const fileName = segments.at(-1) ?? "";
  return fileName === ".ds_store" || fileName.startsWith("~") || fileName.endsWith("~") || fileName.endsWith(".tmp");
}

function toPortablePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isMemoryCandidateStatus(value: string): value is MemoryCandidateRecord["status"] | "all" {
  return ["proposed", "accepted", "rejected", "written", "all"].includes(value);
}

function getRequiredQuery(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  if (!value) throw badRequest(`${key} 不能为空`);
  return value;
}

function getContentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function notFound(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 404 });
}

function getStatusCode(error: unknown): number {
  return typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
    ? error.statusCode
    : 500;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const portArg = process.argv.find((arg) => arg.startsWith("--port="));
  const vaultArg = process.argv.find((arg) => arg.startsWith("--vault="));
  startApothecaryServer({
    port: portArg ? Number(portArg.slice("--port=".length)) : undefined,
    vaultPath: vaultArg ? vaultArg.slice("--vault=".length) : undefined,
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
