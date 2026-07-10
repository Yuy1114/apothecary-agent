import { afterEach, describe, expect, it, vi } from "vitest";
import type { SummarizeFile } from "../ports/fileSummarizer.js";
import { mkdtemp, rm, writeFile, mkdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { syncSemanticsFromChanges } from "./syncSemanticsFromChanges.js";
import { loadSummaries, loadGraph } from "../../vault/semanticStore.js";
import type { PendingChange } from "../../vault/changeLog.js";
import type { FileSummary } from "../../domain/semantic.js";

const dirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function freshVault(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "apothecary-semsync-test-"));
  dirs.push(dir);
  await mkdir(path.join(dir, "notes"), { recursive: true });
  // Vault content lives in `dir`; keep the agent home there too so the semantic
  // layer written by production lands where the test reads it back.
  vi.stubEnv("APOTHECARY_HOME", dir);
  return dir;
}

function pending(overrides: Partial<PendingChange> & { path: string }): PendingChange {
  return {
    id: `change_${overrides.path}`,
    changeType: "modified",
    source: "watcher",
    detectedAt: "2026-07-03T00:00:00.000Z",
    ...overrides,
  };
}

/** Deterministic stub standing in for the LLM summarizer. */
function stubSummarize(): SummarizeFile {
  return vi.fn(async (input) => ({
    path: input.path,
    contentHash: input.contentHash,
    generatedAt: "2026-07-03T00:00:00.000Z",
    title: input.title,
    gist: `gist:${input.path}`,
    topics: ["topic-a"],
    concepts: ["concept-a"],
    summary: `summary:${input.path}`,
  })) as unknown as SummarizeFile;
}

describe("syncSemanticsFromChanges", () => {
  it("returns an empty report and does no work when nothing is pending", async () => {
    const vault = await freshVault();
    const summarize = stubSummarize();
    const report = await syncSemanticsFromChanges(
      { vaultPath: vault },
      { listPendingChanges: async () => [], summarize },
    );
    expect(report.scanned).toBe(0);
    expect(summarize).not.toHaveBeenCalled();
  });

  it("generates a summary for a new file and rebuilds the graph", async () => {
    const vault = await freshVault();
    await writeFile(path.join(vault, "notes/a.md"), "# A\n\nHello world", "utf8");
    const summarize = stubSummarize();

    const report = await syncSemanticsFromChanges(
      { vaultPath: vault },
      { listPendingChanges: async () => [pending({ path: "notes/a.md" })], summarize },
    );

    expect(report).toMatchObject({ scanned: 1, refreshed: 1, pruned: 0, failed: 0 });
    expect(summarize).toHaveBeenCalledOnce();

    const summaries = await loadSummaries(vault);
    expect(summaries["notes/a.md"]).toBeDefined();
    const graph = await loadGraph(vault);
    expect(graph.topics.map((t) => t.label)).toContain("topic-a");
  });

  it("is idempotent: an unchanged file is skipped on the second run", async () => {
    const vault = await freshVault();
    await writeFile(path.join(vault, "notes/a.md"), "# A\n\nHello", "utf8");
    const summarize = stubSummarize();
    const deps = { listPendingChanges: async () => [pending({ path: "notes/a.md" })], summarize };

    await syncSemanticsFromChanges({ vaultPath: vault }, deps);
    const second = await syncSemanticsFromChanges({ vaultPath: vault }, deps);

    expect(second).toMatchObject({ scanned: 1, refreshed: 0, skipped: 1 });
    // The summarizer must not be called again for content that did not change.
    expect(summarize).toHaveBeenCalledOnce();
  });

  it("re-summarizes when the file content changes", async () => {
    const vault = await freshVault();
    const file = path.join(vault, "notes/a.md");
    await writeFile(file, "# A\n\nv1", "utf8");
    const summarize = stubSummarize();
    const deps = { listPendingChanges: async () => [pending({ path: "notes/a.md" })], summarize };

    await syncSemanticsFromChanges({ vaultPath: vault }, deps);
    await writeFile(file, "# A\n\nv2 changed", "utf8");
    const report = await syncSemanticsFromChanges({ vaultPath: vault }, deps);

    expect(report.refreshed).toBe(1);
    expect(summarize).toHaveBeenCalledTimes(2);
  });

  it("prunes the summary of a deleted file", async () => {
    const vault = await freshVault();
    const file = path.join(vault, "notes/a.md");
    await writeFile(file, "# A\n\nHello", "utf8");
    const summarize = stubSummarize();

    await syncSemanticsFromChanges(
      { vaultPath: vault },
      { listPendingChanges: async () => [pending({ path: "notes/a.md" })], summarize },
    );
    expect((await loadSummaries(vault))["notes/a.md"]).toBeDefined();

    await unlink(file);
    const report = await syncSemanticsFromChanges(
      { vaultPath: vault },
      {
        listPendingChanges: async () => [pending({ path: "notes/a.md", changeType: "deleted" })],
        summarize,
      },
    );

    expect(report.pruned).toBe(1);
    expect((await loadSummaries(vault))["notes/a.md"]).toBeUndefined();
  });

  it("counts a summarizer failure without aborting the pass", async () => {
    const vault = await freshVault();
    await writeFile(path.join(vault, "notes/a.md"), "# A", "utf8");
    await writeFile(path.join(vault, "notes/b.md"), "# B", "utf8");
    const summarize = vi.fn(async (input: { path: string; contentHash: string; title: string }) => {
      if (input.path === "notes/a.md") throw new Error("boom");
      return {
        path: input.path,
        contentHash: input.contentHash,
        generatedAt: "2026-07-03T00:00:00.000Z",
        title: input.title,
        gist: "g",
        topics: [],
        concepts: [],
        summary: "s",
      } satisfies FileSummary;
    }) as unknown as SummarizeFile;

    const report = await syncSemanticsFromChanges(
      { vaultPath: vault },
      {
        listPendingChanges: async () => [
          pending({ path: "notes/a.md" }),
          pending({ path: "notes/b.md" }),
        ],
        summarize,
      },
    );

    expect(report).toMatchObject({ refreshed: 1, failed: 1 });
    const summaries = await loadSummaries(vault);
    expect(summaries["notes/b.md"]).toBeDefined();
    expect(summaries["notes/a.md"]).toBeUndefined();
  });

  it("ignores non-markdown changes", async () => {
    const vault = await freshVault();
    const summarize = stubSummarize();
    const report = await syncSemanticsFromChanges(
      { vaultPath: vault },
      {
        listPendingChanges: async () => [pending({ path: "assets/pic.png" })],
        summarize,
      },
    );
    expect(report).toMatchObject({ refreshed: 0, pruned: 0, skipped: 1 });
    expect(summarize).not.toHaveBeenCalled();
  });
});
