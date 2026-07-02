import { describe, expect, it } from "vitest";
import { buildSemanticGraph, semanticNeighbors } from "./semanticGraph.js";
import type { FileSummaries, FileSummary } from "./semantic.js";

function summary(path: string, topics: string[], concepts: string[]): FileSummary {
  return {
    path,
    contentHash: "h",
    generatedAt: "2026-07-02T00:00:00.000Z",
    title: path,
    gist: "g",
    topics,
    concepts,
    summary: "s",
  };
}

const summaries: FileSummaries = {
  "redis/a.md": summary("redis/a.md", ["Redis", "Persistence"], ["AOF", "RDB"]),
  "redis/b.md": summary("redis/b.md", ["redis", "Caching"], ["RDB"]),
  "java/c.md": summary("java/c.md", ["Java"], ["JVM"]),
};

describe("buildSemanticGraph", () => {
  it("groups files by topic, merging case variants, sorted by count", () => {
    const graph = buildSemanticGraph(summaries);
    const redis = graph.topics.find((t) => t.label.toLowerCase() === "redis");
    expect(redis?.files).toEqual(["redis/a.md", "redis/b.md"]); // "Redis" + "redis" merged
    // Most-common topic first.
    expect(graph.topics[0].label.toLowerCase()).toBe("redis");
  });

  it("aggregates concepts across files", () => {
    const graph = buildSemanticGraph(summaries);
    const rdb = graph.concepts.find((c) => c.label === "RDB");
    expect(rdb?.files).toEqual(["redis/a.md", "redis/b.md"]);
  });
});

describe("semanticNeighbors", () => {
  it("finds files sharing topics/concepts, scored and excluding self", () => {
    const graph = buildSemanticGraph(summaries);
    const neighbors = semanticNeighbors(graph, "redis/a.md");
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].path).toBe("redis/b.md");
    expect(neighbors[0].sharedTopics).toEqual(["Redis"]); // via normalized "redis" group
    expect(neighbors[0].sharedConcepts).toEqual(["RDB"]);
    expect(neighbors[0].score).toBe(2 * 1 + 1); // 1 topic *2 + 1 concept
  });

  it("returns empty when a file has no neighbors", () => {
    const graph = buildSemanticGraph(summaries);
    expect(semanticNeighbors(graph, "java/c.md")).toEqual([]);
  });
});
