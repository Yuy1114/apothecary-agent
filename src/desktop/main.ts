import "dotenv/config";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { DesktopService, type DesktopChatMessage } from "../application/desktop/desktopService.js";
import { createDesktopRuntime } from "./runtime.js";
import { registerDesktopIpc } from "./ipc.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..", "..");
const vaultPath = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

function rendererPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "renderer", "index.html")
    : path.join(projectRoot, "src", "desktop", "renderer", "index.html");
}

function formatConversation(messages: DesktopChatMessage[]): string {
  return messages
    .map((message) => `${message.role === "user" ? "用户" : "Apothecary"}: ${message.content}`)
    .join("\n\n");
}

async function createService(): Promise<DesktopService> {
  const runtimeRoot = app.isPackaged ? app.getPath("userData") : projectRoot;
  const desktopRuntime = createDesktopRuntime(runtimeRoot);
  const apothecaryAgent = desktopRuntime.getAgent("apothecaryAgent");
  const service = new DesktopService({
    vaultPath,
    projectRoot: runtimeRoot,
    deps: {
      chat: async (messages) => {
        const result = await apothecaryAgent.generate(formatConversation(messages));
        return result.text;
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
  await window.loadFile(rendererPath());
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
