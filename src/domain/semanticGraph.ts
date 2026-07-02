import type { FileSummaries } from "./semantic.js";
import type { GraphEntry, SemanticGraph } from "./semantic.js";

const normalizeLabel = (label: string): string => label.trim().replace(/\s+/g, " ").toLowerCase();

/** Group file paths by a normalized label, keeping the first-seen original casing. */
function buildEntries(pairs: Array<{ label: string; path: string }>): GraphEntry[] {
  const byKey = new Map<string, { label: string; files: Set<string> }>();
  for (const { label, path } of pairs) {
    const trimmed = label.trim();
    if (!trimmed) continue;
    const key = normalizeLabel(trimmed);
    const entry = byKey.get(key);
    if (entry) entry.files.add(path);
    else byKey.set(key, { label: trimmed, files: new Set([path]) });
  }

  return [...byKey.values()]
    .map((entry) => ({ label: entry.label, files: [...entry.files].sort() }))
    .sort((a, b) => b.files.length - a.files.length || a.label.localeCompare(b.label));
}

/** Aggregate per-file topics/concepts into a cross-file semantic graph. */
export function buildSemanticGraph(summaries: FileSummaries): SemanticGraph {
  const topicPairs: Array<{ label: string; path: string }> = [];
  const conceptPairs: Array<{ label: string; path: string }> = [];

  for (const summary of Object.values(summaries)) {
    for (const topic of summary.topics) topicPairs.push({ label: topic, path: summary.path });
    for (const concept of summary.concepts) conceptPairs.push({ label: concept, path: summary.path });
  }

  return {
    generatedAt: new Date().toISOString(),
    topics: buildEntries(topicPairs),
    concepts: buildEntries(conceptPairs),
  };
}

export type SemanticNeighbor = {
  path: string;
  sharedTopics: string[];
  sharedConcepts: string[];
  score: number;
};

/**
 * Files related to `filePath` via shared topics/concepts (derived `related_to`).
 * Score weights a shared topic more than a shared concept.
 */
export function semanticNeighbors(
  graph: SemanticGraph,
  filePath: string,
  limit = 10,
): SemanticNeighbor[] {
  const neighbors = new Map<string, { topics: Set<string>; concepts: Set<string> }>();

  const collect = (entries: GraphEntry[], kind: "topics" | "concepts") => {
    for (const entry of entries) {
      if (!entry.files.includes(filePath)) continue;
      for (const other of entry.files) {
        if (other === filePath) continue;
        const bucket = neighbors.get(other) ?? { topics: new Set(), concepts: new Set() };
        bucket[kind].add(entry.label);
        neighbors.set(other, bucket);
      }
    }
  };

  collect(graph.topics, "topics");
  collect(graph.concepts, "concepts");

  return [...neighbors.entries()]
    .map(([path, shared]) => ({
      path,
      sharedTopics: [...shared.topics].sort(),
      sharedConcepts: [...shared.concepts].sort(),
      score: shared.topics.size * 2 + shared.concepts.size,
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}
