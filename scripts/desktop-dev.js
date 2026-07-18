import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tscCli = require.resolve("typescript/bin/tsc");
const viteCli = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const electronBinary = require("electron");
const rendererUrl = "http://127.0.0.1:5173";
const electronArgs = process.argv.slice(2);

const backgroundProcesses = new Set();
let electronProcess = null;
let restartRequested = false;
let restartTimer = null;
let shuttingDown = false;
let mainWatchReady = false;

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
  backgroundProcesses.add(child);
  child.once("exit", () => backgroundProcesses.delete(child));
  return child;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = start(command, args);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

async function waitForRenderer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(rendererUrl);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Vite did not start at ${rendererUrl}`);
}

function launchElectron() {
  if (shuttingDown) return;
  restartRequested = false;
  console.log("[desktop:dev] Electron started");
  electronProcess = spawn(electronBinary, [".", ...electronArgs], {
    cwd: projectRoot,
    env: { ...process.env, APOTHECARY_RENDERER_URL: rendererUrl },
    stdio: "inherit",
  });
  electronProcess.once("exit", (code, signal) => {
    electronProcess = null;
    if (shuttingDown) return;
    if (restartRequested) {
      console.log("[desktop:dev] Main process changed; restarting Electron");
      launchElectron();
      return;
    }
    console.log(`[desktop:dev] Electron exited (${signal ?? code ?? 0})`);
    shutdown(code ?? 0);
  });
}

function scheduleElectronRestart() {
  if (shuttingDown) return;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (!electronProcess) return launchElectron();
    restartRequested = true;
    electronProcess.kill("SIGTERM");
  }, 350);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (restartTimer) clearTimeout(restartTimer);
  electronProcess?.kill("SIGTERM");
  for (const child of backgroundProcesses) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 50);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

try {
  await run(process.execPath, [tscCli]);

  const vite = start(process.execPath, [
    viteCli,
    "--config", "vite.desktop.config.ts",
    "--host", "127.0.0.1",
    "--port", "5173",
    "--strictPort",
  ]);
  vite.once("exit", (code) => { if (!shuttingDown) shutdown(code ?? 1); });
  await waitForRenderer();

  const distWatcher = watch(path.join(projectRoot, "dist"), { recursive: true }, (_event, filename) => {
    if (!mainWatchReady) return;
    if (!filename || filename.startsWith(`desktop${path.sep}ui${path.sep}`)) return;
    if (filename.endsWith(".js") || filename.endsWith(".cjs")) scheduleElectronRestart();
  });
  distWatcher.once("error", (error) => {
    console.error("[desktop:dev] dist watcher failed", error);
    shutdown(1);
  });

  const typeScript = start(process.execPath, [tscCli, "--watch", "--preserveWatchOutput"]);
  typeScript.once("exit", (code) => { if (!shuttingDown) shutdown(code ?? 1); });
  // tsc --watch performs one initial emit even though we compiled immediately
  // above. Let that settle before Electron starts so development doesn't open
  // one window and immediately replace it with another.
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  mainWatchReady = true;
  launchElectron();
} catch (error) {
  console.error("[desktop:dev] Failed to start", error);
  shutdown(1);
}
