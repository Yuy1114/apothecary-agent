import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import path from "node:path";
import { writeJsonArtifact, writeMarkdownArtifact } from "../../artifacts/writeAgentArtifact.js";
import { MaintenanceReviewSchema } from "../../domain/maintenanceReview.js";
import { VaultScanSchema } from "../../domain/vault.js";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { scanVault } from "../../vault/scanner.js";
import { ensureAgentArtifacts } from "../../artifacts/agentArtifacts.js";
import { buildMaintenanceReviewContext } from "../../application/review/buildReviewerContext.js";
import { createReviewerModel } from "../../application/review/createReviewerModel.js";
import { normalizeMaintenanceReview } from "../../application/review/normalizeMaintenanceReview.js";
import { renderMaintenanceReviewMarkdown } from "../../reports/renderMaintenanceReviewMarkdown.js";
import { timestampForFile } from "../../utils/time.js";

const ReviewDraftSchema = z.object({
  vaultPath: z.string(),
  scopePath: z.string().optional(),
  reviewJson: z.string(),
  reviewMd: z.string(),
  summary: z.string(),
  findingsCount: z.number(),
  highSeverityCount: z.number(),
});

const ReviewApprovalSchema = ReviewDraftSchema.extend({ approved: z.boolean() });

const ReviewWorkflowOutputSchema = z.object({
  approved: z.boolean(),
  jsonPath: z.string().optional(),
  markdownPath: z.string().optional(),
  reviewJson: z.string(),
  reviewMd: z.string(),
});

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
  outputSchema: z.object({
    vaultPath: z.string(),
    scopePath: z.string().optional(),
    scanId: z.string(),
    scan: VaultScanSchema,
  }),
  execute: async ({ inputData }) => {
    const scan = VaultScanSchema.parse(await scanVault({
      vaultPath: inputData.vaultPath,
      scopePath: inputData.scopePath,
      includeHash: false,
      ignore: [".agent/**", ".apothecary/**", ".obsidian/**", ".trash/**"],
    }));
    return { ...inputData, scanId: scan.id, scan };
  },
});

const draftReviewStep = createStep({
  id: "draft-maintenance-review",
  inputSchema: z.object({
    vaultPath: z.string(),
    scopePath: z.string().optional(),
    scanId: z.string(),
    scan: VaultScanSchema,
  }),
  outputSchema: ReviewDraftSchema,
  execute: async ({ inputData }) => {
    const scan = inputData.scan;
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
    const reviewMd = renderMaintenanceReviewMarkdown(review);

    return {
      vaultPath: inputData.vaultPath,
      scopePath: inputData.scopePath,
      reviewJson: JSON.stringify(review),
      reviewMd,
      summary: review.summary,
      findingsCount: review.findings.length,
      highSeverityCount: review.findings.filter((finding) => finding.severity === "high").length,
    };
  },
});

const requestReviewApprovalStep = createStep({
  id: "request-review-approval",
  inputSchema: ReviewDraftSchema,
  outputSchema: ReviewApprovalSchema,
  suspendSchema: z.object({
    reason: z.string(),
    summary: z.string(),
    findingsCount: z.number(),
    highSeverityCount: z.number(),
    reviewPreview: z.string(),
    reviewPreviewTruncated: z.boolean(),
  }),
  resumeSchema: z.object({ approved: z.boolean() }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      const previewLength = 1200;
      return await suspend({
        reason: "Human approval required before persisting the maintenance review artifact.",
        summary: inputData.summary,
        findingsCount: inputData.findingsCount,
        highSeverityCount: inputData.highSeverityCount,
        reviewPreview: inputData.reviewMd.slice(0, previewLength),
        reviewPreviewTruncated: inputData.reviewMd.length > previewLength,
      });
    }

    return { ...inputData, approved: resumeData.approved };
  },
});

const persistReviewStep = createStep({
  id: "persist-maintenance-review",
  inputSchema: ReviewApprovalSchema,
  outputSchema: ReviewWorkflowOutputSchema,
  execute: async ({ inputData }) => {
    if (!inputData.approved) {
      return {
        approved: false,
        reviewJson: inputData.reviewJson,
        reviewMd: inputData.reviewMd,
      };
    }

    const artifacts = await ensureAgentArtifacts();
    const stamp = timestampForFile();
    const jsonPath = path.join(artifacts.reviewsDir, `review-${stamp}.json`);
    const markdownPath = path.join(artifacts.reviewsDir, `review-${stamp}.md`);
    const review = MaintenanceReviewSchema.parse(JSON.parse(inputData.reviewJson));

    await writeJsonArtifact({ artifacts, artifactPath: jsonPath, value: review });
    await writeMarkdownArtifact({ artifacts, artifactPath: markdownPath, content: inputData.reviewMd });

    return {
      approved: true,
      jsonPath,
      markdownPath,
      reviewJson: inputData.reviewJson,
      reviewMd: inputData.reviewMd,
    };
  },
});

// ── Workflow ──

export const reviewWorkflow = createWorkflow({
  id: "review",
  inputSchema: z.object({ vaultPath: z.string(), scopePath: z.string().optional() }),
  outputSchema: ReviewWorkflowOutputSchema,
})
  .then(resolveVaultStep)
  .then(scanStep)
  .then(draftReviewStep)
  .then(requestReviewApprovalStep)
  .then(persistReviewStep)
  .commit();
