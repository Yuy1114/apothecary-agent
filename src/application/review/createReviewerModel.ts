import type { KnowledgeMap } from "../../domain/knowledgeMap.js";
import type { MaintenanceReview } from "../../domain/maintenanceReview.js";
import type { KnowledgeMapInput, MaintenanceReviewInput, ReviewerModel } from "./reviewerModel.js";
import { vaultReviewer } from "../../mastra/agents/vault-reviewer.js";

const MAP_SYSTEM = [
  "You are apothecary-agent. Generate a knowledge map from the provided vault scan context.",
  "Output valid JSON matching the KnowledgeMap schema. Be concise.",
].join("\n");

const REVIEW_SYSTEM = [
  "You are apothecary-agent. Run a maintenance review from the provided vault scan context.",
  "Output valid JSON matching the MaintenanceReview schema. Be concise.",
].join("\n");

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
        "",
        "Output ONLY valid JSON matching the KnowledgeMap schema.",
      ].join("\n");

      const result = await vaultReviewer.generate(prompt, {
        maxSteps: 1,
        system: MAP_SYSTEM,
      });

      return JSON.parse(extractJson(result.text)) as KnowledgeMap;
    },

    async generateMaintenanceReview(input: MaintenanceReviewInput): Promise<MaintenanceReview> {
      const prompt = [
        "Generate a maintenance review from this vault context.",
        "",
        "Context JSON:",
        JSON.stringify(input.context, null, 2),
        "",
        `Thresholds: longContextWord=${input.options.longContextWordThreshold}, longContextLine=${input.options.longContextLineThreshold}`,
        "",
        "Output ONLY valid JSON matching the MaintenanceReview schema.",
      ].join("\n");

      const result = await vaultReviewer.generate(prompt, {
        maxSteps: 1,
        system: REVIEW_SYSTEM,
      });

      return JSON.parse(extractJson(result.text)) as MaintenanceReview;
    },
  };
}

function extractJson(text: string): string {
  // Handle markdown code fences
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  // Try raw JSON
  const brace = text.indexOf("{");
  if (brace >= 0) return text.slice(brace);
  return text;
}
