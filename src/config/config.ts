import { promises as fs } from "node:fs";
import { parse, stringify } from "yaml";
import { ApothecaryConfigSchema, type ApothecaryConfig } from "../domain/config.js";
import type { AgentArtifacts } from "../artifacts/agentArtifacts.types.js";

export const defaultConfig: ApothecaryConfig = {
  version: 1,
  reviewer: {
    provider: "mastra",
    model: "deepseek-chat",
    baseURL: "https://api.deepseek.com",
  },
  scan: {
    ignore: [".agent/**", ".apothecary/**", ".obsidian/**", ".trash/**", "**/.DS_Store", "**/node_modules/**", "**/.git/**"],
    include_hash: true,
    recent_files_limit: 10,
  },
  map: {
    max_topics: 20,
    max_files_per_topic: 12,
    max_files_per_context: 30,
  },
  review: {
    long_context_word_threshold: 5000,
    long_context_line_threshold: 300,
    max_files_per_context: 200,
    min_review_size_bytes: 100,
  },
};

export const defaultConfigYaml = stringify(defaultConfig);

export async function loadConfig(artifacts: AgentArtifacts): Promise<ApothecaryConfig> {
  const raw = await fs
    .readFile(artifacts.configPath, "utf8")
    .catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    });

  if (!raw) return defaultConfig;

  const parsed = parse(raw) as unknown;
  return ApothecaryConfigSchema.parse(parsed);
}
