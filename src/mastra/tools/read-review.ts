import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getAgentArtifacts } from "../../artifacts/agentArtifacts.js";
import {
  MaintenanceReviewSchema,
  MaintenanceFindingSchema,
} from "../../domain/maintenanceReview.js";

export const readReviewTool = createTool({
  id: "readReview",
  description:
    "Read a persisted maintenance review produced by the review workflow (stored under .agent/reviews). " +
    "Defaults to the most recent review. Use this to pick up findings to act on — turn actionable " +
    "findings into edit proposals with proposeEdit or moves with moveVaultFile.",
  inputSchema: z.object({
    reviewId: z
      .string()
      .optional()
      .describe("Review file stem, e.g. 'review-20260702T101500Z'. Omit for the latest review."),
  }),
  outputSchema: z.object({
    reviewId: z.string(),
    id: z.string(),
    generatedAt: z.string(),
    summary: z.string(),
    findings: z.array(MaintenanceFindingSchema),
  }),
  execute: async ({ reviewId }) => {
    const reviewsDir = getAgentArtifacts().reviewsDir;

    let stem = reviewId;
    if (!stem) {
      let entries: string[];
      try {
        entries = (await fs.readdir(reviewsDir))
          .filter((name) => name.startsWith("review-") && name.endsWith(".json"))
          .sort((a, b) => b.localeCompare(a));
      } catch {
        throw new Error("No maintenance reviews found. Run the review workflow first.");
      }
      if (entries.length === 0) {
        throw new Error("No maintenance reviews found. Run the review workflow first.");
      }
      stem = entries[0].replace(/\.json$/, "");
    }

    const filePath = path.join(reviewsDir, `${stem}.json`);
    const review = MaintenanceReviewSchema.parse(
      JSON.parse(await fs.readFile(filePath, "utf8")),
    );

    return {
      reviewId: stem,
      id: review.id,
      generatedAt: review.generatedAt,
      summary: review.summary,
      findings: review.findings,
    };
  },
});
