import path from "node:path";
import { resolveExistingDirectory } from "../safety/pathSafety.js";
import { scanVault } from "../vault/scanner.js";
import { ensureAgentWorkspace } from "../workspace/agentWorkspace.js";
import { buildDeterministicMaintenanceReview } from "../reviewer/mockMaintenanceReviewer.js";
import { writeJsonAndMarkdown } from "../reports/renderKnowledgeMapMarkdown.js";
import { renderMaintenanceReviewMarkdown } from "../reports/renderMaintenanceReviewMarkdown.js";
import { timestampForFile } from "../utils/time.js";

export type ReviewWorkflowInput = {
  vaultPath: string;
  scopePath?: string;
};

export async function runReviewWorkflow(input: ReviewWorkflowInput): Promise<{ jsonPath: string; markdownPath: string }> {
  const vaultPath = await resolveExistingDirectory(input.vaultPath);
  const workspace = await ensureAgentWorkspace(vaultPath);
  const scan = await scanVault({ vaultPath, scopePath: input.scopePath });
  const review = buildDeterministicMaintenanceReview(scan);
  const stamp = timestampForFile();
  const jsonPath = path.join(workspace.reviewsDir, `review-${stamp}.json`);
  const markdownPath = path.join(workspace.reviewsDir, `review-${stamp}.md`);

  await writeJsonAndMarkdown({
    jsonPath,
    markdownPath,
    value: review,
    markdown: renderMaintenanceReviewMarkdown(review),
  });

  return { jsonPath, markdownPath };
}
