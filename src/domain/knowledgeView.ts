import { z } from "zod";
import type { SemanticGraph } from "./semantic.js";

export const KnowledgeViewDraftSchema = z.object({
  overview: z.string(),
  coreTopics: z.array(z.string()),
  keyConcepts: z.array(z.string()),
  gaps: z.array(z.string()),
  readingOrder: z.array(z.string()),
});
export type KnowledgeViewDraft = z.infer<typeof KnowledgeViewDraftSchema>;

export const KnowledgeViewSchema = KnowledgeViewDraftSchema.extend({
  topic: z.string(),
  generatedAt: z.string(),
  sourceFiles: z.array(z.string()),
});
export type KnowledgeView = z.infer<typeof KnowledgeViewSchema>;

const normalize = (label: string): string => label.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Collect files relevant to a topic from the semantic graph: any topic/concept
 * label that contains or is contained by the query (normalized). Deterministic.
 */
export function assembleViewFiles(graph: SemanticGraph, topic: string): string[] {
  const query = normalize(topic);
  if (!query) return [];

  const files = new Set<string>();
  for (const entry of [...graph.topics, ...graph.concepts]) {
    const label = normalize(entry.label);
    if (label.includes(query) || query.includes(label)) {
      for (const file of entry.files) files.add(file);
    }
  }
  return [...files].sort();
}
