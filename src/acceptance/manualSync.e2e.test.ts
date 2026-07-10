import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSearchIndex, nullSearchIndex } from "../application/ports/searchIndex.js";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initChangeLog, listPendingChanges, resolveChanges, setChangeLogClient } from "../vault/changeLog.js";
import { loadSummaries } from "../vault/semanticStore.js";
import { loadSnapshot } from "../vault/syncSnapshot.js";
import { syncSemanticsFromChanges } from "../application/semantic/syncSemanticsFromChanges.js";

const reindexFile = vi.fn(async () => ({ added: 1 }));
const removeFromIndex = vi.fn(async () => ({ removed: 1 }));
setSearchIndex({ ...nullSearchIndex, reindexFile, removeFromIndex });

const summarize = (async (input: { path: string; title: string; contentHash: string }) => ({
  path: input.path,
  contentHash: input.contentHash,
  generatedAt: "2026-07-03T00:00:00.000Z",
  title: input.title,
  gist: `gist:${input.path}`,
  topics: ["sync"],
  concepts: ["change-awareness"],
  summary: "s",
})) as unknown as typeof import("../application/semantic/generateFileSummary.js").generateFileSummary;

let vault: string;
let manualSync: typeof import("../mastra/tools/manual-sync-core.js").manualSync;
const abs = (rel: string) => path.join(vault, rel);
const refreshSemantics = (input: { vaultPath: string }) =>
  syncSemanticsFromChanges(input, { listPendingChanges, summarize });

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "apothecary-manual-sync-e2e-"));
  await mkdir(abs("notes"), { recursive: true });
  await initChangeLog(`file:${path.join(vault, "changes.db")}`);
  vi.stubEnv("APOTHECARY_HOME", vault);
  ({ manualSync } = await import("../mastra/tools/manual-sync-core.js"));
});

afterEach(async () => {
  setChangeLogClient(null);
  vi.unstubAllEnvs();
  await rm(vault, { recursive: true, force: true });
});

describe("manual CRUD sync end-to-end", () => {
  it("recovers create/modify/delete, updates snapshot and semantics, then becomes idempotent", async () => {
    await writeFile(abs("notes/keep.md"), "# Keep\n\nv1", "utf8");
    await writeFile(abs("notes/gone.md"), "# Gone", "utf8");
    await manualSync({ vaultPath: vault }, { refreshSemantics });
    const initial = await listPendingChanges();
    await resolveChanges(initial.map((c) => c.id), "processed");

    await writeFile(abs("notes/keep.md"), "# Keep\n\nv2 changed", "utf8");
    await writeFile(abs("notes/new.md"), "# New", "utf8");
    await unlink(abs("notes/gone.md"));

    const report = await manualSync({ vaultPath: vault }, { refreshSemantics });
    expect(report).toMatchObject({ created: 1, modified: 1, deleted: 1, semanticRefreshed: true });

    const changes = Object.fromEntries((await listPendingChanges()).map((c) => [c.path, c.changeType]));
    expect(changes).toEqual({
      "notes/gone.md": "deleted",
      "notes/keep.md": "modified",
      "notes/new.md": "created",
    });
    expect(reindexFile).toHaveBeenCalledWith("notes/keep.md");
    expect(reindexFile).toHaveBeenCalledWith("notes/new.md");
    expect(removeFromIndex).toHaveBeenCalledWith("notes/gone.md");

    const summaries = await loadSummaries(vault);
    expect(summaries["notes/keep.md"]).toBeDefined();
    expect(summaries["notes/new.md"]).toBeDefined();
    expect(summaries["notes/gone.md"]).toBeUndefined();
    expect(Object.keys((await loadSnapshot(vault)).files).sort()).toEqual([
      "notes/keep.md",
      "notes/new.md",
    ]);

    const second = await manualSync({ vaultPath: vault }, { refreshSemantics });
    expect(second).toMatchObject({ created: 0, modified: 0, deleted: 0, unchanged: 2, semanticRefreshed: false });
  });
});
