import path from "node:path";
import { resolveExistingDirectory } from "../safety/pathSafety.js";
import { scanVault } from "../vault/scanner.js";
import { ensureAgentWorkspace } from "../workspace/agentWorkspace.js";
import { buildDeterministicKnowledgeMap } from "../reviewer/mockReviewerModel.js";
import { renderKnowledgeMapMarkdown, writeJsonAndMarkdown } from "../reports/renderKnowledgeMapMarkdown.js";

export type MapWorkflowInput = {
  vaultPath: string;
  scopePath?: string;
};

export async function runMapWorkflow(input: MapWorkflowInput): Promise<{ jsonPath: string; markdownPath: string }> {
  const vaultPath = await resolveExistingDirectory(input.vaultPath);
  const workspace = await ensureAgentWorkspace(vaultPath);
  const scan = await scanVault({ vaultPath, scopePath: input.scopePath });
  const map = buildDeterministicKnowledgeMap(scan);
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
