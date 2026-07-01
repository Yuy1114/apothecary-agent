import { promises as fs } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const ProjectConfigSchema = z.object({
  vault: z.object({
    path: z.string().min(1),
  }),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

const PROJECT_CONFIG_FILE = "apothecary.config.yaml";

export async function loadProjectConfig(cwd = process.cwd()): Promise<ProjectConfig | undefined> {
  const configPath = path.join(cwd, PROJECT_CONFIG_FILE);
  const raw = await fs
    .readFile(configPath, "utf8")
    .catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    });

  if (!raw) return undefined;

  return ProjectConfigSchema.parse(parse(raw));
}

export async function resolveVaultPath(vaultOption?: string): Promise<string> {
  if (vaultOption && vaultOption.trim().length > 0) return vaultOption;

  const config = await loadProjectConfig();
  if (config) return config.vault.path;

  throw new Error(
    `Vault path is required. Pass --vault <path> or create ${PROJECT_CONFIG_FILE} with vault.path.`,
  );
}
