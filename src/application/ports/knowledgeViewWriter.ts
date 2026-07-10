import type { KnowledgeViewDraft } from "../../domain/knowledgeView.js";

/** One note's semantic evidence, as handed to the view writer. */
export type ViewEvidence = {
  path: string;
  gist: string;
  topics: string[];
  concepts: string[];
};

/**
 * Writes the prose half of a knowledge view from per-note evidence the use case
 * has already gathered and ranked. Passed in by the caller — every caller of
 * generateKnowledgeView lives in mastra, so no registry is warranted.
 */
export interface KnowledgeViewWriter {
  write(input: { topic: string; evidence: ViewEvidence[] }): Promise<KnowledgeViewDraft>;
}
