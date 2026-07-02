import { describe, expect, it } from "vitest";
import { findDuplicateCandidates } from "./duplicateDetection.js";
import type { SemanticGraph } from "./semantic.js";

const graph: SemanticGraph = {
  generatedAt: "2026-07-02T00:00:00.000Z",
  topics: [{ label: "Redis", files: ["a.md", "b.md", "c.md"] }],
  concepts: [
    { label: "AOF", files: ["a.md", "b.md"] },
    { label: "RDB", files: ["a.md", "b.md"] },
    { label: "Cluster", files: ["a.md", "c.md"] }, // only 1 shared concept for a/c
  ],
};

describe("findDuplicateCandidates", () => {
  it("returns pairs sharing >= minSharedConcepts concepts", () => {
    const candidates = findDuplicateCandidates(graph, { minSharedConcepts: 2 });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].files).toEqual(["a.md", "b.md"]);
    expect(candidates[0].sharedConcepts).toEqual(["AOF", "RDB"]);
    expect(candidates[0].sharedTopics).toEqual(["Redis"]); // context
  });

  it("excludes pairs below the concept threshold", () => {
    // a/c share only 'Cluster' → excluded at minSharedConcepts 2
    const candidates = findDuplicateCandidates(graph, { minSharedConcepts: 2 });
    expect(candidates.some((c) => c.files.includes("c.md"))).toBe(false);
  });

  it("lowering the threshold surfaces more pairs, sorted by shared-concept count", () => {
    const candidates = findDuplicateCandidates(graph, { minSharedConcepts: 1 });
    expect(candidates[0].files).toEqual(["a.md", "b.md"]); // 2 shared concepts, first
    expect(candidates.length).toBeGreaterThan(1);
  });
});
