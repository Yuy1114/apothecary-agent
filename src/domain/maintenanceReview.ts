export type MaintenanceFindingType =
  | "stale_note"
  | "long_context"
  | "orphan_note"
  | "duplicate_topic"
  | "unassimilated_ai_output"
  | "missing_index"
  | "unclear_location";

export type FindingSeverity = "low" | "medium" | "high";

export type MaintenanceFinding = {
  id: string;
  type: MaintenanceFindingType;
  severity: FindingSeverity;
  filePaths: string[];
  observation: string;
  whyItMatters: string;
  suggestion: string;
  relatedFiles: string[];
  confidence: number;
};

export type MaintenanceReview = {
  id: string;
  vaultPath: string;
  scopePath?: string;
  generatedAt: string;
  basedOnScanId: string;
  basedOnMapId?: string;
  findings: MaintenanceFinding[];
  summary: string;
};
