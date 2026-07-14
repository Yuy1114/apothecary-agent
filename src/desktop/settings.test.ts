import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DesktopSettingsSchema,
  firstAvailableVaultPath,
  loadDesktopSettings,
  saveDesktopSettings,
  sanitizeSettings,
  settingsEnv,
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

  it("round-trips extended config fields (incl. encrypted key blobs)", async () => {
    const root = await temporaryDirectory();
    const settingsPath = path.join(root, "desktop-settings.json");
    const settings = {
      vaultPath: path.join(root, "vault"),
      chatModel: "deepseek/deepseek-v4-flash",
      embeddingBaseUrl: "https://api.aihubmix.com/v1",
      embeddingTimeoutMs: 15000,
      watch: false,
      deepseekApiKeyEnc: "Y2lwaGVy",
    };
    await saveDesktopSettings(settingsPath, settings);
    await expect(loadDesktopSettings(settingsPath)).resolves.toEqual(settings);
  });

  it("sanitizeSettings hides key ciphertext behind booleans", () => {
    const view = sanitizeSettings({ vaultPath: "/v", embeddingApiKeyEnc: "x" });
    expect(view).toMatchObject({ vaultPath: "/v", hasEmbeddingKey: true, hasDeepseekKey: false });
    expect(view).not.toHaveProperty("embeddingApiKeyEnc");
  });

  it("settingsEnv maps only defined values and encodes watch-off", () => {
    expect(
      settingsEnv(
        { vaultPath: "/v", embeddingBaseUrl: "https://e/v1", embeddingModel: "m", watch: false },
        { embeddingApiKey: "sk-emb" },
      ),
    ).toEqual({
      APOTHECARY_EMBEDDING_BASE_URL: "https://e/v1",
      APOTHECARY_EMBEDDING_MODEL: "m",
      APOTHECARY_EMBEDDING_API_KEY: "sk-emb",
      APOTHECARY_DESKTOP_WATCH: "0",
    });
    // No keys, watch on → empty env (fall back to ambient/defaults).
    expect(settingsEnv({ vaultPath: "/v", watch: true })).toEqual({});
  });

  it("settingsEnv opts into auto-intake planning only on an explicit true", () => {
    expect(settingsEnv({ vaultPath: "/v", autoIntakePlanning: true })).toEqual({ APOTHECARY_AUTO_INTAKE: "1" });
    // Unset or false stays fully manual.
    expect(settingsEnv({ vaultPath: "/v" })).toEqual({});
    expect(settingsEnv({ vaultPath: "/v", autoIntakePlanning: false })).toEqual({});
  });

  it("drops the legacy autoIntake key so its old default-on value cannot re-arm the feature", () => {
    const parsed = DesktopSettingsSchema.parse({ vaultPath: "/v", autoIntake: true });
    expect(parsed).toEqual({ vaultPath: "/v" });
    expect(settingsEnv(parsed)).toEqual({});
  });
});
