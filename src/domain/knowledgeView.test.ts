import { describe, expect, it } from "vitest";
import { assembleViewFiles } from "./knowledgeView.js";
import type { SemanticGraph } from "./semantic.js";

const graph: SemanticGraph = {
  generatedAt: "2026-07-02T00:00:00.000Z",
  topics: [
    { label: "Redis", files: ["notes/redis/a.md", "notes/redis/b.md"] },
    { label: "Redis Persistence", files: ["notes/redis/b.md"] },
    { label: "Java", files: ["notes/java/c.md"] },
  ],
  concepts: [{ label: "AOF", files: ["notes/redis/a.md"] }],
};

describe("assembleViewFiles", () => {
  it("collects files from topic/concept labels matching the query, deduped", () => {
    // "redis" matches "Redis" and "Redis Persistence"
    expect(assembleViewFiles(graph, "Redis")).toEqual(["notes/redis/a.md", "notes/redis/b.md"]);
  });

  it("matches when a graph label contains the query", () => {
    expect(assembleViewFiles(graph, "persistence")).toEqual(["notes/redis/b.md"]);
  });

  it("returns empty for an unknown topic", () => {
    expect(assembleViewFiles(graph, "kubernetes")).toEqual([]);
  });
});
