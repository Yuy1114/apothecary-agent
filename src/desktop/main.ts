import "dotenv/config";
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type {
  DesktopChatMessage,
  DesktopService,
} from "../application/desktop/desktopService.js";
import { RequestContext } from "@mastra/core/request-context";
import { eventFromMastraChunk, type AgentRunEvent } from "../application/desktop/runEvents.js";
import { registerDesktopIpc } from "./ipc.js";
import {
  firstAvailableVaultPath,
  loadDesktopSettings,
  saveDesktopSettings,
  sanitizeSettings,
  settingsEnv,
  type DesktopSettings,
} from "./settings.js";
import { SaveSettingsInputSchema, SettingsChannel } from "./contracts.js";
import { initFileLogging } from "./logging.js";
import { apothecaryHome } from "../config/apothecaryHome.js";
import { logger } from "../observability/logger.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..", "..");

// Test isolation: on macOS Electron resolves userData natively (Application
// Support), so overriding $HOME does NOT redirect it — a driven test run would
// merge-persist its temp vault path into the real desktop-settings.json. An
// explicit override is the only reliable isolation.
if (process.env.APOTHECARY_USER_DATA_DIR) {
  app.setPath("userData", path.resolve(process.env.APOTHECARY_USER_DATA_DIR));
}
const legacyDefaultVaultPath = "/Users/yuy/apothecary-vault";
let vaultPath = legacyDefaultVaultPath;

function settingsPath(): string {
  return path.join(app.getPath("userData"), "desktop-settings.json");
}

// Secrets are encrypted with the OS keychain-backed key (Electron safeStorage)
// and stored as base64 ciphertext. Where encryption is unavailable (e.g. Linux
// without a keyring) we fall back to base64 so the app still works locally.
function encryptSecret(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) return safeStorage.encryptString(plain).toString("base64");
  return Buffer.from(plain, "utf8").toString("base64");
}
function decryptSecret(enc?: string): string | undefined {
  if (!enc) return undefined;
  const buf = Buffer.from(enc, "base64");
  try {
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(buf);
  } catch {
    // fall through to the base64 fallback below
  }
  return buf.toString("utf8");
}

/** Load settings, merge a patch, persist. Never clobbers fields not in `patch`. */
async function persistSettings(patch: Partial<DesktopSettings>): Promise<DesktopSettings> {
  const existing = (await loadDesktopSettings(settingsPath())) ?? { vaultPath };
  const merged = { ...existing, ...patch };
  await saveDesktopSettings(settingsPath(), merged);
  return merged;
}

/** Push a settings object into process.env so the runtime picks it up on load. */
function applySettingsToEnv(settings: DesktopSettings): void {
  Object.assign(process.env, settingsEnv(settings, {
    deepseekApiKey: decryptSecret(settings.deepseekApiKeyEnc),
    embeddingApiKey: decryptSecret(settings.embeddingApiKeyEnc),
  }));
}

function registerSettingsIpc(): void {
  ipcMain.handle(SettingsChannel.get, async () => {
    const settings = (await loadDesktopSettings(settingsPath())) ?? { vaultPath };
    return sanitizeSettings(settings);
  });
  ipcMain.handle(SettingsChannel.save, async (_event, input) => {
    const { deepseekApiKey, embeddingApiKey, ...config } = SaveSettingsInputSchema.parse(input ?? {});
    const patch: Partial<DesktopSettings> = { ...config };
    // A provided key value replaces (non-empty) or clears ("") the stored secret;
    // an absent field leaves it untouched.
    if (deepseekApiKey !== undefined) patch.deepseekApiKeyEnc = deepseekApiKey ? encryptSecret(deepseekApiKey) : undefined;
    if (embeddingApiKey !== undefined) patch.embeddingApiKeyEnc = embeddingApiKey ? encryptSecret(embeddingApiKey) : undefined;
    const merged = await persistSettings(patch);
    applySettingsToEnv(merged); // diagnostics (which read env live) reflect immediately
    return sanitizeSettings(merged);
  });
  ipcMain.handle(SettingsChannel.chooseVault, async () => {
    const selected = await chooseVaultPath();
    if (!selected) return null;
    const resolved = path.resolve(selected);
    await persistSettings({ vaultPath: resolved });
    return resolved;
  });
  ipcMain.handle(SettingsChannel.relaunch, () => { app.relaunch(); app.exit(0); });
}

async function chooseVaultPath(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "选择 Apothecary 知识药柜",
    message: "选择包含 Markdown 文档的文件夹",
    buttonLabel: "使用这个文件夹",
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

async function resolveVaultPath(): Promise<string> {
  const explicitPath = process.env.APOTHECARY_VAULT_PATH;
  if (explicitPath) {
    const validExplicitPath = await firstAvailableVaultPath([explicitPath]);
    if (!validExplicitPath) throw new Error(`configured_vault_not_found: ${explicitPath}`);
    return validExplicitPath;
  }

  const settings = await loadDesktopSettings(settingsPath());
  const existingPath = await firstAvailableVaultPath([
    settings?.vaultPath,
    legacyDefaultVaultPath,
  ]);
  if (existingPath) return existingPath;

  const selectedPath = await chooseVaultPath();
  if (!selectedPath) throw new Error("vault_selection_cancelled");
  await persistSettings({ vaultPath: path.resolve(selectedPath) });
  return path.resolve(selectedPath);
}

function installApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [{ role: "appMenu" as const }]
      : []),
    {
      label: "药柜",
      submenu: [
        {
          label: "选择其他药柜…",
          click: async () => {
            const selectedPath = await chooseVaultPath();
            if (!selectedPath || path.resolve(selectedPath) === vaultPath) return;
            await persistSettings({ vaultPath: path.resolve(selectedPath) });
            app.relaunch();
            app.exit(0);
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function rendererPath(): string {
  return path.join(app.getAppPath(), "dist", "desktop", "ui", "index.html");
}


/**
 * Drain an agent stream (first run or a resumed run), mapping Mastra chunks to
 * desktop run events, then translate the terminal run status into a timeline
 * signal. A `suspended` run is waiting on a human proposal decision, so it emits
 * no terminal event — the timeline stays paused until resume.
 */
async function pumpAgentStream(
  output: { fullStream: AsyncIterable<unknown>; status: string },
  emit: (event: AgentRunEvent) => void,
  runId: string,
): Promise<void> {
  // Per-tool timing so a slow/stuck run is visible in the log: which tool it is
  // in and for how long. This is the trace to look at when "processing _inbox"
  // appears to hang (e.g. executeIntake spinning on an embedding call).
  const runStarted = Date.now();
  const toolStarts = new Map<string, { name: string; at: number }>();
  logger.info("run", `▶ start ${runId.slice(0, 8)}`);
  for await (const chunk of output.fullStream) {
    const event = eventFromMastraChunk(chunk);
    if (!event) continue;
    if (event.type === "tool_started") {
      toolStarts.set(event.toolCallId, { name: event.toolName, at: Date.now() });
      logger.info("run", `→ tool ${event.toolName}`, { runId: runId.slice(0, 8) });
    } else if (event.type === "tool_completed") {
      const s = toolStarts.get(event.toolCallId);
      const ms = s ? Date.now() - s.at : 0;
      logger[event.failed ? "warn" : "info"]("run", `${event.failed ? "✗" : "✓"} tool ${event.toolName} +${ms}ms`);
    } else if (event.type === "awaiting_decision") {
      logger.info("run", `⏸ awaiting decision (${event.proposal.type})`);
    } else if (event.type === "awaiting_approval") {
      logger.info("run", `⏸ awaiting approval to run ${event.toolName}`);
    }
    emit(event);
  }
  const total = Date.now() - runStarted;
  logger.info("run", `■ ${output.status} +${total}ms ${runId.slice(0, 8)}`);
  if (output.status === "success") emit({ type: "completed" });
  else if (output.status === "canceled") emit({ type: "failed", message: "Agent Run 已取消" });
}

async function createService(): Promise<DesktopService> {
  // Keep the Electron bootstrap light. Loading Mastra and its native storage
  // graph before app.whenReady() can stall packaged applications while Electron
  // is still resolving modules from the asar archive.
  const [{ DesktopService }, { createDesktopRuntime }] = await Promise.all([
    import("../application/desktop/desktopService.js"),
    import("./runtime.js"),
  ]);
  // Loaded sequentially after the runtime graph: these overlap with runtime.js's
  // module graph, and importing an overlapping async ESM graph concurrently can
  // deadlock module evaluation before the window ever opens.
  const { polishNote } = await import("../application/notes/polishNote.js");
  const { mastraNotePolisher } = await import("../mastra/adapters/mastraNotePolisher.js");
  const runtimeRoot = app.isPackaged ? app.getPath("userData") : projectRoot;
  await fs.mkdir(path.join(runtimeRoot, "sql"), { recursive: true });
  const desktopRuntime = createDesktopRuntime(runtimeRoot);
  const apothecaryAgent = desktopRuntime.getAgent("apothecaryAgent");
  // The agent's memory (observational + working) is thread-scoped. Each desktop
  // conversation is one persisted thread under a stable resource, so history can
  // be listed and reopened. `boundMemory` is the storage-backed handle.
  const RESOURCE = "apothecary-desktop";
  const boundMemory = await apothecaryAgent.getMemory();
  // Fallback thread for turns that arrive without a conversation id (e.g. the
  // non-UI chat() path), so memory always has a valid thread.
  const fallbackThread = `desktop-${randomUUID()}`;
  const memoryFor = (threadId?: string) => ({ resource: RESOURCE, thread: threadId ?? fallbackThread });

  // Best-effort extraction of display text from a stored memory message, whose
  // content may be a plain string, an array of parts, or a V2 `{ parts }` object.
  const messageText = (content: unknown): string => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : (p as any)?.text ?? "")).join("");
    if (content && typeof content === "object") {
      const c = content as any;
      if (typeof c.content === "string") return c.content;
      if (Array.isArray(c.parts)) return c.parts.map((p: any) => (p?.type === "text" ? p.text : "")).join("");
    }
    return "";
  };

  // Legacy repair: threads written by the old formatConversation path stored the
  // whole running `用户:/Apothecary:` transcript in each message (compounding every
  // turn). Recover just this turn's real content — the last segment for its role —
  // so multi-turn history replays as individual messages instead of one big blob.
  // Clean (post-fix) messages have no such markers and pass through untouched.
  const USER_PREFIX = "用户: ";
  const AGENT_PREFIX = "Apothecary: ";
  const recoverTurn = (role: "user" | "assistant", raw: unknown): string => {
    const text = messageText(raw).trim();
    const isTranscript = text.startsWith(USER_PREFIX) || text.startsWith(AGENT_PREFIX) || /\n\n(?:用户|Apothecary): /.test(text);
    if (!isTranscript) return text;
    const marker = role === "user" ? USER_PREFIX : AGENT_PREFIX;
    const nlIdx = text.lastIndexOf(`\n${marker}`);
    const from = nlIdx >= 0 ? nlIdx + 1 + marker.length : text.startsWith(marker) ? marker.length : 0;
    let segment = text.slice(from);
    const nextTurn = segment.search(/\n\n(?:用户|Apothecary): /);
    if (nextTurn >= 0) segment = segment.slice(0, nextTurn);
    return segment.trim();
  };

  const service = new DesktopService({
    vaultPath,
    projectRoot: runtimeRoot,
    deps: {
      chat: async (messages, threadId) => {
        // Send only the latest user turn; prior turns come from thread memory
        // (lastMessages). Passing a hand-formatted transcript would persist the
        // "用户:/Apothecary:" prefixes into the stored message, which then leak
        // back when the conversation is replayed from history.
        // Allow enough tool-call steps to finish a maintenance task in one turn.
        const result = await apothecaryAgent.generate(messages.at(-1)?.content ?? "", {
          memory: memoryFor(threadId),
          maxSteps: 20,
        });
        return result.text;
      },
      streamChat: async (messages, emit, runId, threadId) => {
        const output = await apothecaryAgent.stream(messages.at(-1)?.content ?? "", {
          memory: memoryFor(threadId),
          maxSteps: 20,
          runId,
          // Opt this run into the proposeChange suspend/resume gate so a proposal
          // pauses the run for the desktop's approve/reject decision.
          requestContext: new RequestContext([["awaitDesktopDecision", true]]),
        });
        await pumpAgentStream(output, emit, runId);
      },
      resumeRun: async (runId, resumeData, emit) => {
        logger.info("run", `▷ resume ${runId.slice(0, 8)} (${resumeData.decision})`);
        const output = await apothecaryAgent.resumeStream(resumeData, { runId });
        await pumpAgentStream(output, emit, runId);
      },
      approveToolCall: async (runId, toolCallId, decision, emit) => {
        logger.info("run", `▷ ${decision} tool ${runId.slice(0, 8)}`);
        const output = decision === "approve"
          ? await apothecaryAgent.approveToolCall({ runId, toolCallId })
          : await apothecaryAgent.declineToolCall({ runId, toolCallId });
        await pumpAgentStream(output, emit, runId);
      },
      cancelRun: (runId) => apothecaryAgent.abortRunStream(runId),
      polishNote: async (filePath, modes) => {
        logger.info("polish", `▶ ${filePath} [${modes.join(",")}]`);
        const result = await polishNote({ vaultPath, filePath, modes }, mastraNotePolisher);
        logger.info("polish", `■ proposal ${result.proposalId}`);
        return { proposalId: result.proposalId, changeSummary: result.changeSummary };
      },
      listThreads: async () => {
        if (!boundMemory) return [];
        const memory = boundMemory;
        const { threads } = await memory.listThreads({ filter: { resourceId: RESOURCE }, perPage: false });
        // Attach a one-line preview (last human/assistant message) so the history
        // sidebar shows more than the title. Best-effort per thread; recall without
        // a search string is a plain message read (no embedding), so it stays cheap.
        const mapped = await Promise.all(threads.map(async (t) => {
          let preview = "";
          try {
            const { messages } = await memory.recall({ threadId: t.id, resourceId: RESOURCE, perPage: false });
            const last = [...messages].reverse().find((m: any) =>
              (m.role === "user" || m.role === "assistant") && messageText(m.content).trim().length > 0);
            if (last) preview = messageText(last.content).replace(/\s+/g, " ").trim().slice(0, 80);
          } catch { /* preview is optional */ }
          return {
            id: t.id,
            title: (t.title && t.title.trim()) || "新对话",
            createdAt: new Date(t.createdAt).toISOString(),
            updatedAt: new Date(t.updatedAt).toISOString(),
            preview,
          };
        }));
        return mapped.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      },
      threadMessages: async (threadId) => {
        if (!boundMemory) return [];
        const { messages } = await boundMemory.recall({ threadId, resourceId: RESOURCE, perPage: false });
        return messages
          .filter((m: any) => m.role === "user" || m.role === "assistant")
          .map((m: any) => ({ role: m.role as "user" | "assistant", content: recoverTurn(m.role, m.content) }))
          .filter((m) => m.content.trim().length > 0);
      },
      createThread: async (threadId, title) => {
        if (!boundMemory) return;
        await boundMemory.createThread({ resourceId: RESOURCE, threadId, title });
      },
      deleteThread: async (threadId) => {
        await boundMemory?.deleteThread(threadId);
      },
    },
  });
  await service.initialize();
  return service;
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(currentDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  const rendererDevUrl = process.env.APOTHECARY_RENDERER_URL;
  if (rendererDevUrl) await window.loadURL(rendererDevUrl);
  else await window.loadFile(rendererPath());
  const smokePath = process.env.APOTHECARY_DESKTOP_SMOKE_PATH;
  if (smokePath) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const image = await window.webContents.capturePage();
    await fs.writeFile(smokePath, image.toPNG());
    console.log(`Desktop smoke captured: ${smokePath}`);
    app.quit();
  }
}

app
  .whenReady()
  .then(async () => {
    const logFile = await initFileLogging(path.join(apothecaryHome(), "logs")).catch(() => null);
    logger.info("app", `Apothecary desktop starting${logFile ? ` · log → ${logFile}` : ""}`);
    vaultPath = await resolveVaultPath();
    process.env.APOTHECARY_VAULT_PATH = vaultPath;
    const settings = await persistSettings({ vaultPath });
    // Apply saved model/key/URL config to env BEFORE the runtime loads, since
    // rag.ts and the agent read these at module-load time.
    applySettingsToEnv(settings);
    installApplicationMenu();
    const service = await createService();
    registerDesktopIpc(ipcMain, service);
    registerSettingsIpc();
    await createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  })
  .catch((error) => {
    console.error("Apothecary desktop failed to start:", error);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
