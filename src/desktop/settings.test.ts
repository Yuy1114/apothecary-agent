import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  firstAvailableVaultPath,
  loadDesktopSettings,
  saveDesktopSettings,
} from "./settings.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "apothecary-settings-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("desktop settings", () => {
  it("persists and reloads a selected vault", async () => {
    const root = await temporaryDirectory();
    const settingsPath = path.join(root, "desktop-settings.json");
    const vaultPath = path.join(root, "vault");
    await fs.mkdir(vaultPath);

    await saveDesktopSettings(settingsPath, { vaultPath });

    await expect(loadDesktopSettings(settingsPath)).resolves.toEqual({ vaultPath });
  });

  it("selects the first candidate that is an existing directory", async () => {
    const root = await temporaryDirectory();
    const vaultPath = path.join(root, "vault");
    await fs.mkdir(vaultPath);

    await expect(
      firstAvailableVaultPath([path.join(root, "missing"), vaultPath]),
    ).resolves.toBe(vaultPath);
  });

  it("treats malformed settings as absent", async () => {
    const root = await temporaryDirectory();
    const settingsPath = path.join(root, "desktop-settings.json");
    await fs.writeFile(settingsPath, "not-json", "utf8");

    await expect(loadDesktopSettings(settingsPath)).resolves.toBeNull();
  });
});
