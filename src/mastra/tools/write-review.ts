import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createId } from "../../utils/ids.js";

export const writeReviewTool = createTool({
  id: "writeReview",
  description: "Persist maintenance review findings. Call this when your review is complete.",
  inputSchema: z.object({
    findings: z.array(z.object({
      type: z.enum(["stale_note", "long_context", "orphan_note", "duplicate_topic", "unassimilated_ai_output", "missing_index", "unclear_location", "superficial_note"]),
      severity: z.enum(["low", "medium", "high"]),
      filePaths: z.array(z.string()),
      observation: z.string(),
      whyItMatters: z.string(),
      suggestion: z.string(),
      confidence: z.number(),
    })),
    summary: z.string(),
  }),
  outputSchema: z.object({
    id: z.string(),
    findings: z.array(z.object({
      id: z.string(),
      type: z.string(),
      severity: z.string(),
      filePaths: z.array(z.string()),
      observation: z.string(),
      whyItMatters: z.string(),
      suggestion: z.string(),
      confidence: z.number(),
      relatedFiles: z.array(z.string()),
    })),
    summary: z.string(),
    generatedAt: z.string(),
  }),
  execute: async ({ findings, summary }) => {
    return {
      id: createId("review"),
      findings: findings.map((f) => ({ ...f, id: createId("finding"), relatedFiles: [] as string[] })),
      summary,
      generatedAt: new Date().toISOString(),
    };
  },
});
