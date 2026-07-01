import type { ApothecaryConfig } from "../domain/config.js";
import { MastraReviewerModel } from "../agent/mastraReviewerModel.js";
import type { ReviewerModel } from "./reviewerModel.js";

export function createReviewerModel(config: ApothecaryConfig): ReviewerModel {
  return new MastraReviewerModel({
    model: config.reviewer.model,
    apiKey: config.reviewer.apiKey,
    baseURL: config.reviewer.baseURL,
  });
}
