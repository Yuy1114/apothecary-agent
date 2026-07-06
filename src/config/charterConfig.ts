import { promises as fs } from "node:fs";
import { parse, stringify } from "yaml";
import { CharterConfigSchema, defaultCharterConfig, type CharterConfig } from "../domain/charterConfig.js";
import type { AgentArtifacts } from "../artifacts/agentArtifacts.types.js";

/** Bootstrap charter written to a fresh `.apothecary/config.yaml` (if missing). */
export const defaultCharterConfigYaml = stringify(defaultCharterConfig);

/**
 * Load the human charter config from `~/.apothecary/config.yaml`. Missing or
 * unparseable files fall back to defaults so a hand-editing slip never bricks the
 * agent. Valid-but-partial files are completed via the schema's per-field defaults.
 */
export async function loadCharterConfig(artifacts: AgentArtifacts): Promise<CharterConfig> {
  const raw = await fs.readFile(artifacts.configPath, "utf8").catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (!raw) return defaultCharterConfig;

  const parsed = CharterConfigSchema.safeParse(parse(raw) ?? {});
  return parsed.success ? parsed.data : defaultCharterConfig;
}
