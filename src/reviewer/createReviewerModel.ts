import type { ApothecaryConfig } from "../domain/config.js";
import { MastraReviewerModel } from "../agent/mastraReviewerModel.js";
import { DeterministicReviewerModel } from "./deterministicReviewerModel.js";
import { OpenAIReviewerModel } from "./openaiReviewerModel.js";
import type { ReviewerModel } from "./reviewerModel.js";

export function createReviewerModel(config: ApothecaryConfig): ReviewerModel {
  const { provider } = config.reviewer;

  if (provider === "deterministic") {
    return new DeterministicReviewerModel();
  }

  if (provider === "mastra") {
    return new MastraReviewerModel({
      model: config.reviewer.model,
      apiKey: config.reviewer.apiKey,
      baseURL: config.reviewer.baseURL,
    });
  }

  return new OpenAIReviewerModel({
    model: config.reviewer.model,
    apiKey: config.reviewer.apiKey,
    baseURL: config.reviewer.baseURL,
  });
}
