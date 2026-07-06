import { z } from "zod";
import type { KnowledgeMap } from "../../domain/knowledgeMap.js";
import type { MaintenanceReview } from "../../domain/maintenanceReview.js";
import {
  MaintenanceFindingTypeSchema,
  FindingSeveritySchema,
} from "../../domain/maintenanceReview.js";
import {
  KnowledgeTopicCategorySchema,
  TopicFileSchema,
} from "../../domain/knowledgeMap.js";
import type { KnowledgeMapInput, MaintenanceReviewInput, ReviewerModel } from "./reviewerModel.js";
import { reviewModel } from "../../mastra/agents/transformers/review-model.js";
import { createId } from "../../utils/ids.js";

const MAP_SYSTEM = [
  "You are apothecary-agent. Generate a knowledge map from the provided vault scan context.",
  "Group files into meaningful topics. Be concise and specific.",
].join("\n");

const REVIEW_SYSTEM = [
  "You are apothecary-agent. Run a maintenance review from the provided vault scan context.",
  "Report only substantive, actionable findings. Be concise and specific.",
].join("\n");

// ── Lean model-output schemas ──
// The model only fills substantive content. Metadata it cannot know
// (ids, vaultPath, scanId, timestamps) is attached deterministically below.

const LeanFindingSchema = z.object({
  type: MaintenanceFindingTypeSchema,
  severity: FindingSeveritySchema,
  filePaths: z.array(z.string()),
  observation: z.string(),
  whyItMatters: z.string(),
  suggestion: z.string(),
  relatedFiles: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
});

const LeanReviewSchema = z.object({
  findings: z.array(LeanFindingSchema),
});

const LeanTopicSchema = z.object({
  title: z.string(),
  category: KnowledgeTopicCategorySchema,
  summary: z.string(),
  keyConcepts: z.array(z.string()),
  relatedFiles: z.array(TopicFileSchema),
  openQuestions: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

const LeanMapSchema = z.object({
  topics: z.array(LeanTopicSchema),
  summary: z.string(),
});

export function createReviewerModel(_config?: unknown): ReviewerModel {
  return {
    async generateKnowledgeMap(input: KnowledgeMapInput): Promise<KnowledgeMap> {
      const prompt = [
        "Generate a knowledge map from this vault context.",
        "",
        "Context JSON:",
        JSON.stringify(input.context, null, 2),
        "",
        `Constraints: maxTopics=${input.options.maxTopics}, maxFilesPerTopic=${input.options.maxFilesPerTopic}`,
      ].join("\n");

      const result = await reviewModel.generate(prompt, {
        maxSteps: 1,
        system: MAP_SYSTEM,
        // The full scan context is already in the prompt; this is a pure
        // structuring pass, so disable tools to force direct JSON output.
        toolChoice: "none",
        structuredOutput: { schema: LeanMapSchema, jsonPromptInjection: "system" },
      });

      const object = result.object;
      if (!object) {
        throw new Error(
          `Reviewer returned no structured knowledge map (finishReason=${result.finishReason}).`,
        );
      }

      return {
        id: createId("map"),
        vaultPath: input.context.vaultPath,
        scopePath: input.context.scopePath,
        generatedAt: new Date().toISOString(),
        basedOnScanId: input.context.scanId,
        topics: object.topics.map((topic) => ({ ...topic, id: createId("topic") })),
        summary: object.summary,
      };
    },

    async generateMaintenanceReview(input: MaintenanceReviewInput): Promise<MaintenanceReview> {
      const prompt = [
        "Generate a maintenance review from this vault context.",
        "",
        "Context JSON:",
        JSON.stringify(input.context, null, 2),
        "",
        `Thresholds: longContextWord=${input.options.longContextWordThreshold}, longContextLine=${input.options.longContextLineThreshold}`,
      ].join("\n");

      const result = await reviewModel.generate(prompt, {
        maxSteps: 1,
        system: REVIEW_SYSTEM,
        // The full scan context is already in the prompt; this is a pure
        // structuring pass, so disable tools to force direct JSON output.
        toolChoice: "none",
        structuredOutput: { schema: LeanReviewSchema, jsonPromptInjection: "system" },
      });

      const object = result.object;
      if (!object) {
        throw new Error(
          `Reviewer returned no structured maintenance review (finishReason=${result.finishReason}).`,
        );
      }

      return {
        id: createId("review"),
        vaultPath: input.context.vaultPath,
        scopePath: input.context.scopePath,
        generatedAt: new Date().toISOString(),
        basedOnScanId: input.context.scanId,
        findings: object.findings.map((finding) => ({
          ...finding,
          id: createId("finding"),
          relatedFiles: finding.relatedFiles ?? [],
        })),
        // Normalized/regenerated downstream by normalizeMaintenanceReview.
        summary: "",
      };
    },
  };
}
