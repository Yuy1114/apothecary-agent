import { describe, expect, it } from "vitest";
import { buildCanonicalCandidates } from "./canonicalCandidates.js";
import type { SemanticGraph } from "./semantic.js";
import type { RelationsArtifact, Relation } from "./relations.js";

const graph = (concepts: SemanticGraph["concepts"]): SemanticGraph => ({
  generatedAt: "t",
  topics: [],
  concepts,
});

const rel = (from: string, to: string, type: Relation["type"]): Relation => ({
  from,
  to,
  type,
  weight: 1,
  sharedTopics: [],
  sharedConcepts: [],
});

const relations = (rels: Relation[]): RelationsArtifact => ({ generatedAt: "t", relations: rels });

describe("buildCanonicalCandidates", () => {
  it("flags a concept covered by enough files", () => {
    const g = graph([{ label: "Redis", files: ["a.md", "b.md", "c.md"] }]);
    const { candidates } = buildCanonicalCandidates(g, relations([]));
    expect(candidates).toEqual([
      {
        concept: "Redis",
        files: ["a.md", "b.md", "c.md"],
        fileCount: 3,
        duplicatePairs: 0,
        evolutionPairs: 0,
        score: 3,
      },
    ]);
  });

  it("ignores concepts below the file threshold", () => {
    const g = graph([{ label: "Rare", files: ["a.md", "b.md"] }]);
    expect(buildCanonicalCandidates(g, relations([])).candidates).toEqual([]);
  });

  it("respects a custom minFiles", () => {
    const g = graph([{ label: "Pair", files: ["a.md", "b.md"] }]);
    expect(buildCanonicalCandidates(g, relations([]), { minFiles: 2 }).candidates).toHaveLength(1);
  });

  it("weights duplicate/evolution edges among the concept's files", () => {
    const g = graph([{ label: "DB", files: ["a.md", "b.md", "c.md"] }]);
    const r = relations([
      rel("a.md", "b.md", "duplicates"),
      rel("b.md", "c.md", "evolves_with"),
      rel("a.md", "c.md", "related_to"), // not counted
      rel("a.md", "z.md", "duplicates"), // z not in the concept's files
    ]);
    const [candidate] = buildCanonicalCandidates(g, r).candidates;
    expect(candidate).toMatchObject({ duplicatePairs: 1, evolutionPairs: 1, score: 3 + 2 + 2 });
  });

  it("ranks higher-scoring concepts first", () => {
    const g = graph([
      { label: "Low", files: ["a.md", "b.md", "c.md"] },
      { label: "High", files: ["d.md", "e.md", "f.md", "g.md"] },
    ]);
    const names = buildCanonicalCandidates(g, relations([])).candidates.map((c) => c.concept);
    expect(names).toEqual(["High", "Low"]);
  });
});
