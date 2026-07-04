import "dotenv/config";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type {
  DesktopChatMessage,
  DesktopService,
} from "../application/desktop/desktopService.js";
import { eventFromMastraChunk } from "../application/desktop/runEvents.js";
import { registerDesktopIpc } from "./ipc.js";
import {
  firstAvailableVaultPath,
  loadDesktopSettings,
  saveDesktopSettings,
} from "./settings.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..", "..");
const legacyDefaultVaultPath = "/Users/yuy/apothecary-vault";
let vaultPath = legacyDefaultVaultPath;

function settingsPath(): string {
  return path.join(app.getPath("userData"), "desktop-settings.json");
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
  await saveDesktopSettings(settingsPath(), { vaultPath: selectedPath });
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
            await saveDesktopSettings(settingsPath(), { vaultPath: path.resolve(selectedPath) });
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

function formatConversation(messages: DesktopChatMessage[]): string {
  return messages
    .map((message) => `${message.role === "user" ? "用户" : "Apothecary"}: ${message.content}`)
    .join("\n\n");
}

async function createService(): Promise<DesktopService> {
  // Keep the Electron bootstrap light. Loading Mastra and its native storage
  // graph before app.whenReady() can stall packaged applications while Electron
  // is still resolving modules from the asar archive.
  const [{ DesktopService }, { createDesktopRuntime }] = await Promise.all([
    import("../application/desktop/desktopService.js"),
    import("./runtime.js"),
  ]);
  const runtimeRoot = app.isPackaged ? app.getPath("userData") : projectRoot;
  await fs.mkdir(path.join(runtimeRoot, "sql"), { recursive: true });
  const desktopRuntime = createDesktopRuntime(runtimeRoot);
  const apothecaryAgent = desktopRuntime.getAgent("apothecaryAgent");
  // The agent's memory (observational + working) is thread-scoped, so generate()
  // needs a thread + resource. Give this desktop session one identity so memory
  // has a valid thread; a fresh thread per launch keeps sessions clean.
  const memory = { resource: "apothecary-desktop", thread: `desktop-${randomUUID()}` };
  const service = new DesktopService({
    vaultPath,
    projectRoot: runtimeRoot,
    deps: {
      chat: async (messages) => {
        // Allow enough tool-call steps to actually finish a maintenance task
        // (scan + read several files + produce proposals) in one turn.
        const result = await apothecaryAgent.generate(formatConversation(messages), {
          memory,
          maxSteps: 20,
        });
        return result.text;
      },
      streamChat: async (messages, emit) => {
        const output = await apothecaryAgent.stream(formatConversation(messages), {
          memory,
          maxSteps: 20,
        });
        for await (const chunk of output.fullStream) {
          const event = eventFromMastraChunk(chunk);
          if (event) emit(event);
        }
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
    backgroundColor: "#f4f0e8",
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
    vaultPath = await resolveVaultPath();
    process.env.APOTHECARY_VAULT_PATH = vaultPath;
    await saveDesktopSettings(settingsPath(), { vaultPath });
    installApplicationMenu();
    const service = await createService();
    registerDesktopIpc(ipcMain, service);
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
