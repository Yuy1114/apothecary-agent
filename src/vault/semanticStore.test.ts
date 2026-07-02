import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadSummaries,
  saveSummaries,
  needsRefresh,
  upsertSummary,
  pruneMissing,
} from "./semanticStore.js";
import type { FileSummaries, FileSummary } from "../domain/semantic.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function summary(pathValue: string, hash: string): FileSummary {
  return {
    path: pathValue,
    contentHash: hash,
    generatedAt: "2026-07-02T00:00:00.000Z",
    title: "t",
    gist: "g",
    topics: ["x"],
    concepts: ["y"],
    summary: "s",
  };
}

describe("semanticStore", () => {
  it("needsRefresh: new, changed, unchanged", () => {
    const s: FileSummaries = { "a.md": summary("a.md", "h1") };
    expect(needsRefresh(s, "b.md", "h9")).toBe(true); // new
    expect(needsRefresh(s, "a.md", "h2")).toBe(true); // changed
    expect(needsRefresh(s, "a.md", "h1")).toBe(false); // unchanged
  });

  it("upsert replaces by path", () => {
    let s: FileSummaries = { "a.md": summary("a.md", "h1") };
    s = upsertSummary(s, summary("a.md", "h2"));
    expect(s["a.md"].contentHash).toBe("h2");
  });

  it("pruneMissing drops entries whose file is gone", () => {
    const s: FileSummaries = {
      "a.md": summary("a.md", "h1"),
      "gone.md": summary("gone.md", "h1"),
    };
    const { summaries, pruned } = pruneMissing(s, ["a.md"]);
    expect(pruned).toBe(1);
    expect(Object.keys(summaries)).toEqual(["a.md"]);
  });

  it("save then load round-trips", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "apothecary-semantic-test-"));
    dirs.push(dir);
    const s: FileSummaries = { "a.md": summary("a.md", "h1") };
    await saveSummaries(dir, s);
    expect(await loadSummaries(dir)).toEqual(s);
  });

  it("load returns {} when no file exists", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "apothecary-semantic-test-"));
    dirs.push(dir);
    expect(await loadSummaries(dir)).toEqual({});
  });
});
