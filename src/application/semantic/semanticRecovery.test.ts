import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { enqueueSemanticRecovery, retrySemanticRecovery } from "./semanticRecovery.js";
import {
  initChangeLog,
  setChangeLogClient,
  listPendingChanges,
} from "../../vault/changeLog.js";

const dirs: string[] = [];

beforeEach(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "apothecary-recovery-test-"));
  dirs.push(dir);
  await initChangeLog(`file:${path.join(dir, "change-log.db")}`);
});

afterEach(async () => {
  setChangeLogClient(null);
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const vault = "/tmp/does-not-matter"; // syncPaths is injected, so no fs is touched

describe("semantic recovery", () => {
  it("enqueues affected paths as proposal-sourced pending work", async () => {
    await enqueueSemanticRecovery(["notes/a.md", "notes/b.md"]);
    const pending = await listPendingChanges();
    expect(pending).toHaveLength(2);
    expect(pending.every((c) => c.source === "proposal")).toBe(true);
  });

  it("retries the work and resolves it when the refresh succeeds", async () => {
    await enqueueSemanticRecovery(["notes/a.md"]);
    const syncPaths = vi.fn(async () => ({}));

    const report = await retrySemanticRecovery({ vaultPath: vault }, { syncPaths });

    expect(syncPaths).toHaveBeenCalledWith({ vaultPath: vault, paths: ["notes/a.md"] });
    expect(report).toEqual({ pending: 1, resolved: 1 });
    // The recovery work is drained.
    expect(await listPendingChanges()).toEqual([]);
  });

  it("keeps the work pending when the refresh fails again", async () => {
    await enqueueSemanticRecovery(["notes/a.md"]);
    const syncPaths = vi.fn(async () => {
      throw new Error("still failing");
    });

    const report = await retrySemanticRecovery({ vaultPath: vault }, { syncPaths });

    expect(report).toEqual({ pending: 1, resolved: 0 });
    expect(await listPendingChanges()).toHaveLength(1);
  });

  it("is a no-op when there is no recovery work", async () => {
    const syncPaths = vi.fn(async () => ({}));
    expect(await retrySemanticRecovery({ vaultPath: vault }, { syncPaths })).toEqual({
      pending: 0,
      resolved: 0,
    });
    expect(syncPaths).not.toHaveBeenCalled();
  });
});
