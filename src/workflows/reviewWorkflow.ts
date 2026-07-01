import path from "node:path";
import { loadConfig } from "../config/config.js";
import { MaintenanceReviewSchema } from "../domain/maintenanceReview.js";
import { VaultScanSchema } from "../domain/vault.js";
import { resolveExistingDirectory } from "../safety/pathSafety.js";
import { scanVault } from "../vault/scanner.js";
import { ensureAgentWorkspace } from "../workspace/agentWorkspace.js";
import { buildMaintenanceReviewContext } from "../reviewer/buildReviewerContext.js";
import { createReviewerModel } from "../reviewer/createReviewerModel.js";
import { normalizeMaintenanceReview } from "../reviewer/normalizeMaintenanceReview.js";
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
  const config = await loadConfig(workspace);
  const scan = VaultScanSchema.parse(await scanVault({
    vaultPath,
    scopePath: input.scopePath,
    includeHash: config.scan.include_hash,
    ignore: config.scan.ignore,
    recentFilesLimit: config.scan.recent_files_limit,
  }));
  const context = buildMaintenanceReviewContext(scan);
  const reviewer = createReviewerModel(config);
  const rawReview = MaintenanceReviewSchema.parse(
    await reviewer.generateMaintenanceReview({
      context,
      options: {
        longContextWordThreshold: config.review.long_context_word_threshold,
        longContextLineThreshold: config.review.long_context_line_threshold,
      },
    }),
  );
  const review = MaintenanceReviewSchema.parse(normalizeMaintenanceReview(rawReview));
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
