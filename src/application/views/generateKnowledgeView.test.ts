import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveGraph, saveSummaries } from "../../vault/semanticStore.js";
import { setSearchIndex, nullSearchIndex, type SearchHit } from "../ports/searchIndex.js";
import type { KnowledgeViewWriter, ViewEvidence } from "../ports/knowledgeViewWriter.js";
import type { FileSummary } from "../../domain/semantic.js";
import { generateKnowledgeView } from "./generateKnowledgeView.js";

const summary = (p: string, gist: string): FileSummary => ({
  path: p,
  contentHash: `hash-${p}`,
  generatedAt: "2026-01-01T00:00:00.000Z",
  title: p,
  gist,
  topics: ["Redis"],
  concepts: ["cache"],
  summary: `${gist} (long form)`,
});

/** Records what the use case handed the writer, and returns a fixed draft. */
function recordingWriter() {
  const seen: { topic: string; evidence: ViewEvidence[] }[] = [];
  const writer: KnowledgeViewWriter = {
    async write(input) {
      seen.push(input);
      return {
        overview: "overview",
        coreTopics: ["Redis"],
        keyConcepts: ["cache"],
        gaps: [],
        readingOrder: ["notes/redis.md"],
      };
    },
  };
  return { writer, seen };
}

let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "apothecary-view-"));
  vi.stubEnv("APOTHECARY_HOME", home);
  setSearchIndex(nullSearchIndex);

  await saveGraph(home, {
    generatedAt: "2026-01-01T00:00:00.000Z",
    topics: [{ label: "Redis", files: ["notes/redis.md", "notes/orphan.md"] }],
    concepts: [],
  });
  // orphan.md is in the graph but has no summary — it must be filtered out.
  await saveSummaries(home, { "notes/redis.md": summary("notes/redis.md", "redis basics") });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

describe("generateKnowledgeView", () => {
  it("passes only summarized graph matches to the writer as evidence", async () => {
    const { writer, seen } = recordingWriter();

    const view = await generateKnowledgeView("Redis", writer);

    expect(seen).toHaveLength(1);
    expect(seen[0].topic).toBe("Redis");
    expect(seen[0].evidence).toEqual([
      { path: "notes/redis.md", gist: "redis basics", topics: ["Redis"], concepts: ["cache"] },
    ]);
    expect(view.sourceFiles).toEqual(["notes/redis.md"]);
    expect(view.overview).toBe("overview");
  });

  it("folds search-index hits in alongside graph matches, deduplicated", async () => {
    await saveSummaries(home, {
      "notes/redis.md": summary("notes/redis.md", "redis basics"),
      "notes/cluster.md": summary("notes/cluster.md", "redis cluster"),
    });
    const hits: SearchHit[] = [
      { source: "notes/cluster.md", content: "…" },
      { source: "notes/redis.md", content: "…" }, // already matched by the graph
    ];
    setSearchIndex({ ...nullSearchIndex, queryVault: async () => hits });
    const { writer, seen } = recordingWriter();

    const view = await generateKnowledgeView("Redis", writer);

    expect(view.sourceFiles).toEqual(["notes/redis.md", "notes/cluster.md"]);
    expect(seen[0].evidence.map((e) => e.path)).toEqual(["notes/redis.md", "notes/cluster.md"]);
  });

  it("still calls the writer when nothing matches, with empty evidence", async () => {
    const { writer, seen } = recordingWriter();

    const view = await generateKnowledgeView("Kafka", writer);

    expect(seen[0].evidence).toEqual([]);
    expect(view.sourceFiles).toEqual([]);
  });
});
