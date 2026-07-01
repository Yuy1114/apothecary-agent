import type { KnowledgeMap } from "../domain/knowledgeMap.js";
import type { MaintenanceReview } from "../domain/maintenanceReview.js";
import type { VaultScan } from "../domain/vault.js";

export type KnowledgeMapInput = {
  scan: VaultScan;
  options: {
    maxTopics: number;
    maxFilesPerTopic: number;
  };
};

export type MaintenanceReviewInput = {
  scan: VaultScan;
  options: {
    longContextWordThreshold: number;
    longContextLineThreshold: number;
  };
};

export interface ReviewerModel {
  generateKnowledgeMap(input: KnowledgeMapInput): Promise<KnowledgeMap>;
  generateMaintenanceReview(input: MaintenanceReviewInput): Promise<MaintenanceReview>;
}
