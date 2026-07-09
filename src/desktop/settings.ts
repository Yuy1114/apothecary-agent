import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const DesktopSettingsSchema = z.object({
  vaultPath: z.string().min(1),
  chatModel: z.string().optional(),
  deepseekBaseUrl: z.string().optional(),
  embeddingBaseUrl: z.string().optional(),
  embeddingModel: z.string().optional(),
  embeddingTimeoutMs: z.number().int().positive().optional(),
  watch: z.boolean().optional(),
  autoIntake: z.boolean().optional(),
  // Secrets are stored as base64 ciphertext from Electron safeStorage — never
  // plaintext on disk, and never sent to the renderer (see sanitizeSettings).
  deepseekApiKeyEnc: z.string().optional(),
  embeddingApiKeyEnc: z.string().optional(),
});

export type DesktopSettings = z.infer<typeof DesktopSettingsSchema>;

/** Renderer-safe view: config fields plus booleans for whether each key is set. */
export type PublicDesktopSettings = Omit<DesktopSettings, "deepseekApiKeyEnc" | "embeddingApiKeyEnc"> & {
  hasDeepseekKey: boolean;
  hasEmbeddingKey: boolean;
};

export function sanitizeSettings(settings: DesktopSettings): PublicDesktopSettings {
  const { deepseekApiKeyEnc, embeddingApiKeyEnc, ...rest } = settings;
  return { ...rest, hasDeepseekKey: Boolean(deepseekApiKeyEnc), hasEmbeddingKey: Boolean(embeddingApiKeyEnc) };
}

/**
 * Map settings + already-decrypted keys to the env vars the runtime reads
 * (rag.ts embedder, the agent model, connection diagnostics). Only defined
 * values are emitted, so unset settings fall back to any ambient env / defaults.
 */
export function settingsEnv(
  settings: Partial<DesktopSettings>,
  keys: { deepseekApiKey?: string; embeddingApiKey?: string } = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  const put = (k: string, v?: string) => { if (v) env[k] = v; };
  put("APOTHECARY_CHAT_MODEL", settings.chatModel);
  put("DEEPSEEK_API_KEY", keys.deepseekApiKey);
  put("DEEPSEEK_BASE_URL", settings.deepseekBaseUrl);
  put("APOTHECARY_EMBEDDING_API_KEY", keys.embeddingApiKey);
  put("APOTHECARY_EMBEDDING_BASE_URL", settings.embeddingBaseUrl);
  put("APOTHECARY_EMBEDDING_MODEL", settings.embeddingModel);
  if (settings.embeddingTimeoutMs) env.APOTHECARY_EMBEDDING_TIMEOUT_MS = String(settings.embeddingTimeoutMs);
  if (settings.watch === false) env.APOTHECARY_DESKTOP_WATCH = "0";
  // Opt-in only: auto-intake files-in-place from `_inbox` without a per-batch
  // approval, so it must be turned on explicitly (an unset/false toggle stays
  // manual). The watcher reads this env; it takes effect on the next relaunch.
  if (settings.autoIntake === true) env.APOTHECARY_AUTO_INTAKE = "1";
  return env;
}

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
