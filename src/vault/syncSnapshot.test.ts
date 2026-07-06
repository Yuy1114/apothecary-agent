import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  commitSelfWrite,
  diffSnapshot,
  loadSnapshot,
  saveSnapshot,
  type SnapshotFiles,
} from "./syncSnapshot.js";

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

describe("commitSelfWrite", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });
  // vault == home for the test: snapshot lands at <vault>/sync/snapshot.json.
  const freshVault = async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "apothecary-commit-test-"));
    dirs.push(vault);
    await mkdir(path.join(vault, "notes"), { recursive: true });
    return vault;
  };

  it("upserts hashes for existing files and drops missing ones", async () => {
    const vault = await freshVault();
    await writeFile(path.join(vault, "notes/a.md"), "content A", "utf8");
    await saveSnapshot(vault, { generatedAt: "", files: h({ "notes/gone.md": "old" }) });

    await commitSelfWrite(vault, ["notes/a.md", "notes/gone.md"], vault);

    const snap = await loadSnapshot(vault);
    expect(snap.files["notes/a.md"].hash).toMatch(/^[a-f0-9]{64}$/); // real sha256
    expect(snap.files["notes/gone.md"]).toBeUndefined(); // committed while absent → dropped
  });

  it("updates the hash when a file's content changed", async () => {
    const vault = await freshVault();
    const file = path.join(vault, "notes/a.md");
    await writeFile(file, "v1", "utf8");
    await commitSelfWrite(vault, ["notes/a.md"], vault);
    const first = (await loadSnapshot(vault)).files["notes/a.md"].hash;

    await writeFile(file, "v2 different", "utf8");
    await commitSelfWrite(vault, ["notes/a.md"], vault);
    const second = (await loadSnapshot(vault)).files["notes/a.md"].hash;

    expect(second).not.toEqual(first);
  });

  it("ignores non-baseline paths (non-md and archived) to stay in step with the scan", async () => {
    const vault = await freshVault();
    await writeFile(path.join(vault, "notes/a.md"), "keep", "utf8");
    await mkdir(path.join(vault, "archive"), { recursive: true });
    await writeFile(path.join(vault, "archive/old.md"), "archived", "utf8");
    await writeFile(path.join(vault, "notes/pic.png"), "binary", "utf8");

    await commitSelfWrite(vault, ["notes/a.md", "archive/old.md", "notes/pic.png"], vault);

    const files = (await loadSnapshot(vault)).files;
    expect(Object.keys(files)).toEqual(["notes/a.md"]);
  });

  it("does not lose updates when commits run concurrently (serialized)", async () => {
    const vault = await freshVault();
    await writeFile(path.join(vault, "notes/a.md"), "A", "utf8");
    await writeFile(path.join(vault, "notes/b.md"), "B", "utf8");

    await Promise.all([
      commitSelfWrite(vault, ["notes/a.md"], vault),
      commitSelfWrite(vault, ["notes/b.md"], vault),
    ]);

    const files = (await loadSnapshot(vault)).files;
    expect(Object.keys(files).sort()).toEqual(["notes/a.md", "notes/b.md"]);
  });
});
