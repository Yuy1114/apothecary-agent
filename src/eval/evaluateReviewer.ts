import { DeterministicReviewerModel } from "../reviewer/deterministicReviewerModel.js";
import type { KnowledgeMapContext, MaintenanceReviewContext } from "../reviewer/reviewerContext.js";
import type { KnowledgeMapInput, MaintenanceReviewInput, ReviewerModel } from "../reviewer/reviewerModel.js";

export type ReviewEvalResult = {
  /** Name of the reviewer being evaluated */
  reviewerName: string;
  /** Findings produced */
  findingTypes: string[];
  /** Finding coverage: how many of the deterministic baseline finding types were also found */
  coverage: number;
  /** Finding types present in deterministic but missing here */
  missingFromBaseline: string[];
  /** Finding types added beyond deterministic */
  newFindings: string[];
  /** Total finding count */
  totalFindings: number;
  /** Review summary */
  summary: string;
};

/**
 * Evaluate a reviewer against the deterministic baseline using the same context.
 */
export async function evaluateReviewer(
  name: string,
  reviewer: ReviewerModel,
  context: MaintenanceReviewContext,
  mapOptions: KnowledgeMapInput["options"],
  reviewOptions: MaintenanceReviewInput["options"],
): Promise<ReviewEvalResult> {
  const deterministic = new DeterministicReviewerModel();
  const baselineReview = await deterministic.generateMaintenanceReview({ context, options: reviewOptions });
  const baselineTypes = new Set(baselineReview.findings.map((f) => f.type));

  const review = await reviewer.generateMaintenanceReview({ context, options: reviewOptions });
  const candidateTypes = new Set(review.findings.map((f) => f.type));

  const missingFromBaseline = [...baselineTypes].filter((t) => !candidateTypes.has(t));
  const newFindings = [...candidateTypes].filter((t) => !baselineTypes.has(t));

  return {
    reviewerName: name,
    findingTypes: [...candidateTypes],
    coverage: baselineTypes.size === 0 ? 1 : (baselineTypes.size - missingFromBaseline.length) / baselineTypes.size,
    missingFromBaseline,
    newFindings,
    totalFindings: review.findings.length,
    summary: review.summary,
  };
}
