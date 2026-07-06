import { Agent } from "@mastra/core/agent";

/**
 * Bare model for the review pipeline (createReviewerModel). The knowledge-map
 * and maintenance-review passes are pure structuring calls — each sets its own
 * `system` prompt, disables tools (`toolChoice: "none"`), and uses
 * structuredOutput — so this needs only a model, no tools/memory/processors.
 * Replaces the legacy vault-reviewer persona, which was used here for its model
 * alone while its instructions and tools were overridden away.
 */
export const reviewModel = new Agent({
  id: "review-model",
  name: "Review Model",
  description: "Bare model for the review and knowledge-map structuring passes.",
  instructions: "Follow the per-call system prompt and return the requested structured output.",
  model: "deepseek/deepseek-v4-flash",
});
