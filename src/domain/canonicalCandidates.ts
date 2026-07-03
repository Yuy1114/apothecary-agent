import { z } from "zod";
import type { SemanticGraph } from "./semantic.js";
import type { RelationsArtifact } from "./relations.js";

/**
 * Concepts that are spread across enough notes to warrant a single canonical
 * note. Deterministically derived from the semantic graph (which concept covers
 * which files) and weighted by the relation layer: files linked by `duplicates`
 * or `supersedes` edges make consolidation more valuable. The base for the
 * canonical_note proposal; consumed today via edit/merge proposals.
 */
export const CanonicalCandidateSchema = z.object({
  concept: z.string(),
  files: z.array(z.string()),
  fileCount: z.number(),
  /** `duplicates` edges among the candidate's files. */
  duplicatePairs: z.number(),
  /** `supersedes` edges among the candidate's files. */
  supersedesPairs: z.number(),
  /** Consolidation priority (higher = more worth a canonical note). */
  score: z.number(),
});
export type CanonicalCandidate = z.infer<typeof CanonicalCandidateSchema>;

export const CanonicalCandidatesArtifactSchema = z.object({
  generatedAt: z.string(),
  candidates: z.array(CanonicalCandidateSchema),
});
export type CanonicalCandidatesArtifact = z.infer<typeof CanonicalCandidatesArtifactSchema>;

/**
 * Build the canonical-candidate list. A concept covered by at least `minFiles`
 * notes is a candidate; its score is the file count plus a bonus for each
 * duplicate/supersedes edge among those notes (consolidation signal). Pure.
 */
export function buildCanonicalCandidates(
  graph: SemanticGraph,
  relations: RelationsArtifact,
  options: { minFiles?: number } = {},
): CanonicalCandidatesArtifact {
  const minFiles = options.minFiles ?? 3;
  const candidates: CanonicalCandidate[] = [];

  for (const entry of graph.concepts) {
    if (entry.files.length < minFiles) continue;
    const set = new Set(entry.files);

    let duplicatePairs = 0;
    let supersedesPairs = 0;
    for (const relation of relations.relations) {
      if (!set.has(relation.from) || !set.has(relation.to)) continue;
      if (relation.type === "duplicates") duplicatePairs += 1;
      else if (relation.type === "supersedes") supersedesPairs += 1;
    }

    candidates.push({
      concept: entry.label,
      files: [...entry.files].sort(),
      fileCount: entry.files.length,
      duplicatePairs,
      supersedesPairs,
      score: entry.files.length + duplicatePairs * 2 + supersedesPairs * 2,
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.concept.localeCompare(b.concept));
  return { generatedAt: new Date().toISOString(), candidates };
}
