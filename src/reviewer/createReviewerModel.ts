import type { ApothecaryConfig } from "../domain/config.js";
import { DeterministicReviewerModel } from "./deterministicReviewerModel.js";
import type { ReviewerModel } from "./reviewerModel.js";

export function createReviewerModel(config: ApothecaryConfig): ReviewerModel {
  switch (config.reviewer.provider) {
    case "deterministic":
      return new DeterministicReviewerModel();
    default: {
      const exhaustive: never = config.reviewer.provider;
      throw new Error(`Unsupported reviewer provider: ${exhaustive}`);
    }
  }
}
