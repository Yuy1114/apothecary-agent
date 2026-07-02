import { z } from "zod";

export const FileSummarySchema = z.object({
  path: z.string().min(1),
  contentHash: z.string().min(1),
  generatedAt: z.string().min(1),
  title: z.string(),
  /** One-line gist of what the file is about. */
  gist: z.string(),
  /** High-level topics the file belongs to. */
  topics: z.array(z.string()),
  /** Key concepts covered. */
  concepts: z.array(z.string()),
  /** Short paragraph summary. */
  summary: z.string(),
});
export type FileSummary = z.infer<typeof FileSummarySchema>;

/** Map keyed by relative vault path. */
export const FileSummariesSchema = z.record(z.string(), FileSummarySchema);
export type FileSummaries = z.infer<typeof FileSummariesSchema>;

export const GraphEntrySchema = z.object({
  label: z.string(),
  files: z.array(z.string()),
});
export type GraphEntry = z.infer<typeof GraphEntrySchema>;

/** Deterministic cross-file index derived from file summaries. */
export const SemanticGraphSchema = z.object({
  generatedAt: z.string(),
  topics: z.array(GraphEntrySchema),
  concepts: z.array(GraphEntrySchema),
});
export type SemanticGraph = z.infer<typeof SemanticGraphSchema>;

/** The model-generated portion (metadata is attached deterministically). */
export const FileSummaryDraftSchema = z.object({
  gist: z.string(),
  topics: z.array(z.string()),
  concepts: z.array(z.string()),
  summary: z.string(),
});
export type FileSummaryDraft = z.infer<typeof FileSummaryDraftSchema>;
