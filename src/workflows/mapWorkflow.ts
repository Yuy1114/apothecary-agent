import path from "node:path";
import { loadConfig } from "../config/config.js";
import { KnowledgeMapSchema } from "../domain/knowledgeMap.js";
import { VaultScanSchema } from "../domain/vault.js";
import { resolveExistingDirectory } from "../safety/pathSafety.js";
import { scanVault } from "../vault/scanner.js";
import { ensureAgentWorkspace } from "../workspace/agentWorkspace.js";
import { DeterministicReviewerModel } from "../reviewer/deterministicReviewerModel.js";
import { renderKnowledgeMapMarkdown, writeJsonAndMarkdown } from "../reports/renderKnowledgeMapMarkdown.js";

export type MapWorkflowInput = {
  vaultPath: string;
  scopePath?: string;
};

export async function runMapWorkflow(input: MapWorkflowInput): Promise<{ jsonPath: string; markdownPath: string }> {
  const vaultPath = await resolveExistingDirectory(input.vaultPath);
  const workspace = await ensureAgentWorkspace(vaultPath);
  const config = await loadConfig(workspace);
  const scan = VaultScanSchema.parse(await scanVault({
    vaultPath,
    scopePath: input.scopePath,
    includeHash: config.scan.include_hash,
    ignore: config.scan.ignore,
    recentFilesLimit: config.scan.recent_files_limit,
  }));
  const reviewer = new DeterministicReviewerModel();
  const map = KnowledgeMapSchema.parse(
    await reviewer.generateKnowledgeMap({
      scan,
      options: {
        maxTopics: config.map.max_topics,
        maxFilesPerTopic: config.map.max_files_per_topic,
      },
    }),
  );
  const jsonPath = path.join(workspace.mapsDir, "knowledge-map.json");
  const markdownPath = path.join(workspace.mapsDir, "knowledge-map.md");

  await writeJsonAndMarkdown({
    jsonPath,
    markdownPath,
    value: map,
    markdown: renderKnowledgeMapMarkdown(map),
  });

  return { jsonPath, markdownPath };
}
