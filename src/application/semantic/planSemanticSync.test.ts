import { describe, expect, it } from "vitest";
import { planSemanticSync, type ChangedFileState } from "./planSemanticSync.js";
import type { FileSummaries, FileSummary } from "../../domain/semantic.js";

function summary(path: string, contentHash: string): FileSummary {
  return {
    path,
    contentHash,
    generatedAt: "2026-07-03T00:00:00.000Z",
    title: path,
    gist: "gist",
    topics: [],
    concepts: [],
    summary: "summary",
  };
}

const md = (path: string, hash: string | null, exists = true): ChangedFileState => ({
  path,
  exists,
  hash,
  isMarkdown: true,
});

describe("planSemanticSync", () => {
  it("refreshes a brand-new markdown file with no stored summary", () => {
    const plan = planSemanticSync([md("notes/new.md", "h1")], {});
    expect(plan).toEqual({ toRefresh: ["notes/new.md"], toPrune: [], upToDate: [], ignored: [] });
  });

  it("refreshes a modified file whose hash no longer matches its summary", () => {
    const summaries: FileSummaries = { "notes/a.md": summary("notes/a.md", "old") };
    const plan = planSemanticSync([md("notes/a.md", "new")], summaries);
    expect(plan.toRefresh).toEqual(["notes/a.md"]);
    expect(plan.upToDate).toEqual([]);
  });

  it("leaves an unchanged file up-to-date so re-runs stay cheap", () => {
    const summaries: FileSummaries = { "notes/a.md": summary("notes/a.md", "same") };
    const plan = planSemanticSync([md("notes/a.md", "same")], summaries);
    expect(plan.upToDate).toEqual(["notes/a.md"]);
    expect(plan.toRefresh).toEqual([]);
  });

  it("prunes a deleted file that still has a stored summary", () => {
    const summaries: FileSummaries = { "notes/gone.md": summary("notes/gone.md", "h") };
    const plan = planSemanticSync([md("notes/gone.md", null, false)], summaries);
    expect(plan.toPrune).toEqual(["notes/gone.md"]);
  });

  it("ignores a deletion for a file we never summarized", () => {
    const plan = planSemanticSync([md("notes/gone.md", null, false)], {});
    expect(plan.toPrune).toEqual([]);
    expect(plan.ignored).toEqual(["notes/gone.md"]);
  });

  it("ignores non-markdown changes entirely", () => {
    const plan = planSemanticSync(
      [{ path: "assets/pic.png", exists: true, hash: "h", isMarkdown: false }],
      {},
    );
    expect(plan.ignored).toEqual(["assets/pic.png"]);
    expect(plan.toRefresh).toEqual([]);
  });

  it("dedupes a repeated path, never both refreshing and pruning it", () => {
    const plan = planSemanticSync([md("notes/a.md", "h"), md("notes/a.md", null, false)], {});
    expect(plan.toRefresh).toEqual(["notes/a.md"]);
    expect(plan.toPrune).toEqual([]);
  });

  it("partitions a mixed batch correctly", () => {
    const summaries: FileSummaries = {
      "notes/same.md": summary("notes/same.md", "s"),
      "notes/edited.md": summary("notes/edited.md", "old"),
      "notes/deleted.md": summary("notes/deleted.md", "d"),
    };
    const plan = planSemanticSync(
      [
        md("notes/new.md", "n"),
        md("notes/same.md", "s"),
        md("notes/edited.md", "new"),
        md("notes/deleted.md", null, false),
        { path: "notes/img.png", exists: true, hash: "p", isMarkdown: false },
      ],
      summaries,
    );
    expect(plan.toRefresh.sort()).toEqual(["notes/edited.md", "notes/new.md"]);
    expect(plan.upToDate).toEqual(["notes/same.md"]);
    expect(plan.toPrune).toEqual(["notes/deleted.md"]);
    expect(plan.ignored).toEqual(["notes/img.png"]);
  });
});
