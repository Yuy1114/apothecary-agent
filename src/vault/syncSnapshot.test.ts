import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { diffSnapshot, loadSnapshot, saveSnapshot, type SnapshotFiles } from "./syncSnapshot.js";

const h = (files: Record<string, string>): SnapshotFiles =>
  Object.fromEntries(Object.entries(files).map(([p, hash]) => [p, { hash }]));

describe("diffSnapshot", () => {
  it("classifies created / modified / deleted / unchanged", () => {
    const previous = h({ "a.md": "1", "b.md": "2", "gone.md": "3" });
    const current = h({ "a.md": "1", "b.md": "changed", "new.md": "9" });

    expect(diffSnapshot(previous, current)).toEqual({
      created: ["new.md"],
      modified: ["b.md"],
      deleted: ["gone.md"],
      unchanged: ["a.md"],
    });
  });

  it("treats everything as created against an empty snapshot", () => {
    const diff = diffSnapshot({}, h({ "a.md": "1", "b.md": "2" }));
    expect(diff.created).toEqual(["a.md", "b.md"]);
    expect(diff.modified).toEqual([]);
    expect(diff.deleted).toEqual([]);
  });

  it("reports no changes when nothing moved", () => {
    const files = h({ "a.md": "1" });
    expect(diffSnapshot(files, files)).toEqual({
      created: [],
      modified: [],
      deleted: [],
      unchanged: ["a.md"],
    });
  });

  it("sorts each bucket for stable output", () => {
    const diff = diffSnapshot({}, h({ "z.md": "1", "a.md": "1", "m.md": "1" }));
    expect(diff.created).toEqual(["a.md", "m.md", "z.md"]);
  });
});

describe("snapshot store", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it("round-trips a saved snapshot and defaults to empty when absent", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "apothecary-snapshot-test-"));
    dirs.push(vault);

    expect(await loadSnapshot(vault)).toEqual({ generatedAt: "", files: {} });

    await saveSnapshot(vault, { generatedAt: "2026-07-03T00:00:00.000Z", files: h({ "a.md": "1" }) });
    const loaded = await loadSnapshot(vault);
    expect(loaded.files["a.md"]).toEqual({ hash: "1" });
  });
});
