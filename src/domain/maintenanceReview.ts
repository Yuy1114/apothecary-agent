import { z } from "zod";

export const MaintenanceFindingTypeSchema = z.enum([
  "stale_note",
  "long_context",
  "orphan_note",
  "duplicate_topic",
  "unassimilated_ai_output",
  "missing_index",
  "unclear_location",
  "superficial_note",
]);
export type MaintenanceFindingType = z.infer<typeof MaintenanceFindingTypeSchema>;

export const FindingSeveritySchema = z.enum(["low", "medium", "high"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const MaintenanceFindingSchema = z.object({
  id: z.string().min(1),
  type: MaintenanceFindingTypeSchema,
  severity: FindingSeveritySchema,
  filePaths: z.array(z.string().min(1)),
  observation: z.string().min(1),
  whyItMatters: z.string().min(1),
  suggestion: z.string().min(1),
  relatedFiles: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export type MaintenanceFinding = z.infer<typeof MaintenanceFindingSchema>;

export const MaintenanceReviewSchema = z.object({
  id: z.string().min(1),
  vaultPath: z.string().min(1),
  scopePath: z.string().optional(),
  generatedAt: z.string().min(1),
  basedOnScanId: z.string().min(1),
  basedOnMapId: z.string().optional(),
  findings: z.array(MaintenanceFindingSchema),
  summary: z.string(),
});
export type MaintenanceReview = z.infer<typeof MaintenanceReviewSchema>;
