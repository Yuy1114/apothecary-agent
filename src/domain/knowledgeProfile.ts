import { z } from "zod";
import type { FileSummaries } from "./semantic.js";
import type { SemanticGraph } from "./semantic.js";
import type { DuplicateReport } from "./duplicateDetection.js";

export const LabelCountSchema = z.object({ label: z.string(), fileCount: z.number() });

export const ProfileStatsSchema = z.object({
  fileCount: z.number(),
  topicCount: z.number(),
  conceptCount: z.number(),
  byDirectory: z.array(z.object({ dir: z.string(), fileCount: z.number() })),
  topTopics: z.array(LabelCountSchema),
  topConcepts: z.array(LabelCountSchema),
  duplicates: z.object({ harmful: z.number(), contextual: z.number(), evolutionary: z.number() }),
});
export type ProfileStats = z.infer<typeof ProfileStatsSchema>;

export const ProfileNarrativeSchema = z.object({
  overview: z.string(),
  activeProjects: z.array(z.string()),
  evidenceAreas: z.array(z.string()),
  weakAreas: z.array(z.string()),
  recommendations: z.array(z.string()),
});
export type ProfileNarrative = z.infer<typeof ProfileNarrativeSchema>;

export const KnowledgeProfileSchema = ProfileNarrativeSchema.extend({
  generatedAt: z.string(),
  stats: ProfileStatsSchema,
});
export type KnowledgeProfile = z.infer<typeof KnowledgeProfileSchema>;

const TOP_N = 15;

/** Deterministic whole-vault stats aggregated from the semantic layer. */
export function buildProfileStats(
  summaries: FileSummaries,
  graph: SemanticGraph,
  dupReport: DuplicateReport,
): ProfileStats {
  const paths = Object.keys(summaries);

  const dirCounts = new Map<string, number>();
  for (const p of paths) {
    const dir = p.split("/")[0] || ".";
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }
  const byDirectory = [...dirCounts.entries()]
    .map(([dir, fileCount]) => ({ dir, fileCount }))
    .sort((a, b) => b.fileCount - a.fileCount || a.dir.localeCompare(b.dir));

  const toLabelCount = (entries: SemanticGraph["topics"]) =>
    entries.slice(0, TOP_N).map((e) => ({ label: e.label, fileCount: e.files.length }));

  const countByClass = (c: string) =>
    dupReport.clusters.filter((cluster) => cluster.classification === c).length;

  return {
    fileCount: paths.length,
    topicCount: graph.topics.length,
    conceptCount: graph.concepts.length,
    byDirectory,
    topTopics: toLabelCount(graph.topics),
    topConcepts: toLabelCount(graph.concepts),
    duplicates: {
      harmful: countByClass("harmful_duplicate"),
      contextual: countByClass("contextual_repetition"),
      evolutionary: countByClass("evolutionary_duplicate"),
    },
  };
}
