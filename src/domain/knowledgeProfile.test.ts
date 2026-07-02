import { describe, expect, it } from "vitest";
import { buildProfileStats } from "./knowledgeProfile.js";
import type { FileSummaries, FileSummary, SemanticGraph } from "./semantic.js";
import type { DuplicateReport } from "./duplicateDetection.js";

function summary(path: string): FileSummary {
  return {
    path,
    contentHash: "h",
    generatedAt: "2026-07-02T00:00:00.000Z",
    title: path,
    gist: "g",
    topics: [],
    concepts: [],
    summary: "s",
  };
}

const summaries: FileSummaries = {
  "notes/redis/a.md": summary("notes/redis/a.md"),
  "notes/redis/b.md": summary("notes/redis/b.md"),
  "career/c.md": summary("career/c.md"),
};

const graph: SemanticGraph = {
  generatedAt: "2026-07-02T00:00:00.000Z",
  topics: [
    { label: "Redis", files: ["notes/redis/a.md", "notes/redis/b.md"] },
    { label: "Career", files: ["career/c.md"] },
  ],
  concepts: [{ label: "AOF", files: ["notes/redis/a.md"] }],
};

const dupReport: DuplicateReport = {
  generatedAt: "2026-07-02T00:00:00.000Z",
  clusters: [
    {
      files: ["notes/redis/a.md", "notes/redis/b.md"],
      sharedTopics: ["Redis"],
      sharedConcepts: ["AOF", "RDB"],
      classification: "harmful_duplicate",
      recommendedAction: "merge",
      rationale: "r",
    },
  ],
};

describe("buildProfileStats", () => {
  it("aggregates counts, directories, top labels, and duplicate classes", () => {
    const stats = buildProfileStats(summaries, graph, dupReport);
    expect(stats.fileCount).toBe(3);
    expect(stats.topicCount).toBe(2);
    expect(stats.conceptCount).toBe(1);
    expect(stats.byDirectory[0]).toEqual({ dir: "notes", fileCount: 2 });
    expect(stats.topTopics[0]).toEqual({ label: "Redis", fileCount: 2 });
    expect(stats.duplicates).toEqual({ harmful: 1, contextual: 0, evolutionary: 0 });
  });
});
