import path from "node:path";
import { writeJsonArtifact, writeMarkdownArtifact } from "../artifacts/writeAgentArtifact.js";
import { loadConfig } from "../config/config.js";
import { KnowledgeMapSchema } from "../domain/knowledgeMap.js";
import { VaultScanSchema } from "../domain/vault.js";
import { resolveExistingDirectory } from "../safety/pathSafety.js";
import { scanVault } from "../vault/scanner.js";
import { ensureAgentWorkspace } from "../workspace/agentWorkspace.js";
import { buildKnowledgeMapContext } from "../reviewer/buildReviewerContext.js";
import { createReviewerModel } from "../reviewer/createReviewerModel.js";
import { renderKnowledgeMapMarkdown } from "../reports/renderKnowledgeMapMarkdown.js";

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
  const context = buildKnowledgeMapContext(scan);
  const reviewer = createReviewerModel(config);
  const map = KnowledgeMapSchema.parse(
    await reviewer.generateKnowledgeMap({
      context,
      options: {
        maxTopics: config.map.max_topics,
        maxFilesPerTopic: config.map.max_files_per_topic,
      },
    }),
  );
  const jsonPath = path.join(workspace.mapsDir, "knowledge-map.json");
  const markdownPath = path.join(workspace.mapsDir, "knowledge-map.md");

  await writeJsonArtifact({ workspace, artifactPath: jsonPath, value: map });
  await writeMarkdownArtifact({ workspace, artifactPath: markdownPath, content: renderKnowledgeMapMarkdown(map) });

  return { jsonPath, markdownPath };
}
