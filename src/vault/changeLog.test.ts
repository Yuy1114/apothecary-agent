import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  initChangeLog,
  setChangeLogClient,
  enqueueChange,
  listPendingChanges,
  resolveChanges,
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

  it("is a safe no-op before initialization", async () => {
    setChangeLogClient(null);
    await expect(
      enqueueChange({ path: "x.md", changeType: "created", source: "watcher" }),
    ).resolves.toBeUndefined();
    expect(await listPendingChanges()).toEqual([]);
    expect(await resolveChanges(["nope"], "processed")).toBe(0);
  });
});
