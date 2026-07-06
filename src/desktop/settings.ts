import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

const DesktopSettingsSchema = z.object({
  vaultPath: z.string().min(1),
});

export type DesktopSettings = z.infer<typeof DesktopSettingsSchema>;

export async function isDirectory(directoryPath: string): Promise<boolean> {
  try {
    return (await fs.stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}

export async function loadDesktopSettings(settingsPath: string): Promise<DesktopSettings | null> {
  try {
    return DesktopSettingsSchema.parse(JSON.parse(await fs.readFile(settingsPath, "utf8")));
  } catch {
    return null;
  }
}

export async function saveDesktopSettings(
  settingsPath: string,
  settings: DesktopSettings,
): Promise<void> {
  const parsed = DesktopSettingsSchema.parse(settings);
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

export async function firstAvailableVaultPath(candidates: Array<string | undefined>): Promise<string | null> {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (await isDirectory(resolved)) return resolved;
  }
  return null;
}
