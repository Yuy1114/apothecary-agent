import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  initChangeLog,
  setChangeLogClient,
  enqueueChange,
  listPendingChanges,
  listRecentChanges,
  resolveChanges,
  resolvePendingByPaths,
} from "./changeLog.js";

const dirs: string[] = [];

afterEach(async () => {
  setChangeLogClient(null);
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function freshLedger(): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "apothecary-changelog-test-"));
  dirs.push(dir);
  await initChangeLog(`file:${path.join(dir, "change-log.db")}`);
}

describe("changeLog", () => {
  it("dedupes a pending path instead of inserting duplicates", async () => {
    await freshLedger();
    await enqueueChange({ path: "notes/a.md", changeType: "created", source: "watcher" });
    await enqueueChange({ path: "notes/a.md", changeType: "modified", source: "watcher" });

    const pending = await listPendingChanges();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ path: "notes/a.md", changeType: "modified" });
  });

  it("lists multiple distinct pending changes", async () => {
    await freshLedger();
    await enqueueChange({ path: "notes/a.md", changeType: "modified", source: "watcher" });
    await enqueueChange({ path: "notes/b.md", changeType: "deleted", source: "watcher" });
    expect(await listPendingChanges()).toHaveLength(2);
  });

  it("resolves changes so they drop out of pending", async () => {
    await freshLedger();
    await enqueueChange({ path: "notes/a.md", changeType: "modified", source: "watcher" });
    await enqueueChange({ path: "notes/b.md", changeType: "modified", source: "watcher" });
    const pending = await listPendingChanges();

    const resolved = await resolveChanges([pending[0].id], "processed");
    expect(resolved).toBe(1);
    const remaining = await listPendingChanges();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(pending[1].id);
  });

  it("resolves pending changes by path when the agent handles them", async () => {
    await freshLedger();
    await enqueueChange({ path: "_inbox/idea.md", changeType: "created", source: "manual" });
    await enqueueChange({ path: "notes/keep.md", changeType: "modified", source: "watcher" });

    // Agent moved _inbox/idea.md → notes/idea.md; clearing both paths drops the
    // stale inbox entry but leaves the untouched pending change.
    const cleared = await resolvePendingByPaths(["_inbox/idea.md", "notes/idea.md"]);
    expect(cleared).toBe(1);
    const remaining = await listPendingChanges();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].path).toBe("notes/keep.md");
    // Idempotent: re-clearing an already-handled path clears nothing.
    expect(await resolvePendingByPaths(["_inbox/idea.md"])).toBe(0);
  });

  it("lists recent changes regardless of triage status", async () => {
    await freshLedger();
    await enqueueChange({ path: "notes/a.md", changeType: "created", source: "watcher" });
    await enqueueChange({ path: "notes/b.md", changeType: "modified", source: "manual" });
    const [first] = await listPendingChanges();
    await resolveChanges([first.id], "processed");

    const recent = await listRecentChanges({ since: "2000-01-01T00:00:00.000Z" });
    expect(recent).toHaveLength(2);
    expect(new Set(recent.map((c) => c.status))).toEqual(new Set(["pending", "processed"]));

    expect(await listRecentChanges({ since: "9999-01-01T00:00:00.000Z" })).toEqual([]);
    expect(
      await listRecentChanges({ since: "2000-01-01T00:00:00.000Z", limit: 1 }),
    ).toHaveLength(1);
  });

  it("is a safe no-op before initialization", async () => {
    setChangeLogClient(null);
    await expect(
      enqueueChange({ path: "x.md", changeType: "created", source: "watcher" }),
    ).resolves.toBeUndefined();
    expect(await listPendingChanges()).toEqual([]);
    expect(await listRecentChanges({ since: "2000-01-01T00:00:00.000Z" })).toEqual([]);
    expect(await resolveChanges(["nope"], "processed")).toBe(0);
    expect(await resolvePendingByPaths(["x.md"])).toBe(0);
  });
});
