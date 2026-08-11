import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
// The desktop's settings module is Electron-free (fs + zod only). The CLI reads
// the same file rather than re-declaring its shape, so the two composition roots
// can never disagree about which vault is current. If a third root ever needs
// it, this contract should move down into config/.
import { loadDesktopSettings } from "../desktop/settings.js";

/**
 * Resolve the vault the CLI should report on, in the same order of authority a
 * user would expect:
 *
 *   1. an explicit `--vault` argument
 *   2. `APOTHECARY_VAULT_PATH`
 *   3. whatever vault the desktop app is currently pointed at
 *   4. the built-in default
 *
 * Step 3 is what keeps `apo` honest: the app lets you switch vaults, and a CLI
 * that silently kept reporting on the old one would be worse than no CLI.
 */

export const DEFAULT_VAULT_PATH = path.join(os.homedir(), "apothecary-vault");

/**
 * Electron derives userData from the app name, which has changed across builds
 * (dev uses package.json `name`, packaged uses productName). Rather than guess
 * one, read every historical location and trust the most recently written.
 */
const APP_DIR_NAMES = [
  "apothecary-agent",
  "Apothecary",
  "Apothecary Agent",
  "apothecary-desktop",
  "apothecary-electron-app",
];

function userDataRoots(): string[] {
  const home = os.homedir();
  if (process.platform === "darwin") return [path.join(home, "Library", "Application Support")];
  if (process.platform === "win32") {
    return [process.env.APPDATA ?? path.join(home, "AppData", "Roaming")];
  }
  return [process.env.XDG_CONFIG_HOME ?? path.join(home, ".config")];
}

/** The vault the desktop app last persisted, or null if it has never run. */
export async function desktopVaultPath(): Promise<string | null> {
  const candidates = userDataRoots().flatMap((root) =>
    APP_DIR_NAMES.map((name) => path.join(root, name, "desktop-settings.json")),
  );

  let newest: { vaultPath: string; mtimeMs: number } | null = null;
  for (const file of candidates) {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) continue;
    const settings = await loadDesktopSettings(file);
    if (!settings) continue;
    if (!newest || stat.mtimeMs > newest.mtimeMs) {
      newest = { vaultPath: settings.vaultPath, mtimeMs: stat.mtimeMs };
    }
  }
  return newest?.vaultPath ?? null;
}

export async function resolveVaultPath(explicit?: string): Promise<string> {
  if (explicit) return path.resolve(explicit);
  if (process.env.APOTHECARY_VAULT_PATH) return path.resolve(process.env.APOTHECARY_VAULT_PATH);
  const fromDesktop = await desktopVaultPath();
  return path.resolve(fromDesktop ?? DEFAULT_VAULT_PATH);
}
