import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import path from "node:path";
import { writeJsonArtifact, writeMarkdownArtifact } from "../../artifacts/writeAgentArtifact.js";
import { MaintenanceReviewSchema } from "../../domain/maintenanceReview.js";
import { VaultScanSchema } from "../../domain/vault.js";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { scanVault } from "../../vault/scanner.js";
import { ensureAgentWorkspace } from "../../workspace/agentWorkspace.js";
import { buildMaintenanceReviewContext } from "../../reviewer/buildReviewerContext.js";
import { createReviewerModel } from "../../reviewer/createReviewerModel.js";
import { normalizeMaintenanceReview } from "../../reviewer/normalizeMaintenanceReview.js";
import { renderMaintenanceReviewMarkdown } from "../../reports/renderMaintenanceReviewMarkdown.js";
import { timestampForFile } from "../../utils/time.js";

// ── Steps ──

const resolveVaultStep = createStep({
  id: "resolve-vault",
  inputSchema: z.object({ vaultPath: z.string(), scopePath: z.string().optional() }),
  outputSchema: z.object({ vaultPath: z.string(), scopePath: z.string().optional() }),
  execute: async ({ inputData }) => {
    const vaultPath = await resolveExistingDirectory(inputData.vaultPath);
    return { vaultPath, scopePath: inputData.scopePath };
  },
});

const scanStep = createStep({
  id: "scan",
  inputSchema: z.object({ vaultPath: z.string(), scopePath: z.string().optional() }),
  outputSchema: z.object({ vaultPath: z.string(), scopePath: z.string().optional(), scanId: z.string() }),
  execute: async ({ inputData }) => {
    const workspace = await ensureAgentWorkspace(inputData.vaultPath);
    const scan = VaultScanSchema.parse(await scanVault({
      vaultPath: inputData.vaultPath,
      scopePath: inputData.scopePath,
      includeHash: false,
      ignore: [".agent/**", ".apothecary/**", ".obsidian/**", ".trash/**"],
    }));
    // Store scan in state for next steps
    return { ...inputData, scanId: scan.id, _scan: scan, _workspace: workspace };
  },
});

const reviewStep = createStep({
  id: "agent-review",
  inputSchema: z.object({ vaultPath: z.string(), scopePath: z.string().optional(), scanId: z.string() }),
  outputSchema: z.object({
    jsonPath: z.string(),
    markdownPath: z.string(),
    reviewJson: z.string(),
    reviewMd: z.string(),
  }),
  execute: async ({ inputData }) => {
    const scan = (inputData as any)._scan;
    const workspace = (inputData as any)._workspace;
    const context = buildMaintenanceReviewContext(scan, {
      maxFiles: 20,
      minSizeBytes: 100,
    });
    const reviewer = createReviewerModel();
    const rawReview = MaintenanceReviewSchema.parse(
      await reviewer.generateMaintenanceReview({
        context,
        options: { longContextWordThreshold: 3000, longContextLineThreshold: 200 },
      }),
    );
    const review = MaintenanceReviewSchema.parse(normalizeMaintenanceReview(rawReview));
    const stamp = timestampForFile();
    const jsonPath = path.join(workspace.reviewsDir, `review-${stamp}.json`);
    const markdownPath = path.join(workspace.reviewsDir, `review-${stamp}.md`);
    const reviewMd = renderMaintenanceReviewMarkdown(review);

    await writeJsonArtifact({ workspace, artifactPath: jsonPath, value: review });
    await writeMarkdownArtifact({ workspace, artifactPath: markdownPath, content: reviewMd });

    return { jsonPath, markdownPath, reviewJson: JSON.stringify(review), reviewMd };
  },
});

// ── Workflow ──

export const reviewWorkflow = createWorkflow({
  id: "review",
  inputSchema: z.object({ vaultPath: z.string(), scopePath: z.string().optional() }),
  outputSchema: z.object({
    jsonPath: z.string(),
    markdownPath: z.string(),
    reviewJson: z.string(),
    reviewMd: z.string(),
  }),
})
  .then(resolveVaultStep)
  .then(scanStep)
  .then(reviewStep)
  .commit();
