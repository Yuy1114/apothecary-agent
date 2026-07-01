import type { KnowledgeMap } from "../domain/knowledgeMap.js";
import type { MaintenanceReview } from "../domain/maintenanceReview.js";
import type { KnowledgeMapContext, MaintenanceReviewContext } from "./reviewerContext.js";

export type KnowledgeMapInput = {
  context: KnowledgeMapContext;
  options: {
    maxTopics: number;
    maxFilesPerTopic: number;
  };
};

export type MaintenanceReviewInput = {
  context: MaintenanceReviewContext;
  options: {
    longContextWordThreshold: number;
    longContextLineThreshold: number;
  };
};

export interface ReviewerModel {
  generateKnowledgeMap(input: KnowledgeMapInput): Promise<KnowledgeMap>;
  generateMaintenanceReview(input: MaintenanceReviewInput): Promise<MaintenanceReview>;
}
