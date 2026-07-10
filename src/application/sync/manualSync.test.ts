import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSearchIndex, nullSearchIndex } from "../ports/searchIndex.js";
import { mkdtemp, rm, writeFile, mkdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  initChangeLog,
  setChangeLogClient,
  listPendingChanges,
} from "../../vault/changeLog.js";
import { commitSelfWrite } from "../../vault/syncSnapshot.js";

// Vector index out of scope; stub it. The change ledger is real (temp libsql).
const reindexFile = vi.fn(async () => ({ added: 0 }));
const removeFromIndex = vi.fn(async () => ({ removed: 0 }));
setSearchIndex({ ...nullSearchIndex, reindexFile, removeFromIndex });

// Import after the mocks exist (the factory runs on first import of rag.js).
let manualSync: typeof import("./manualSync.js").manualSync;

let vault: string;
const refreshSemantics = vi.fn(async () => ({}));
const abs = (rel: string) => path.join(vault, rel);

beforeAll(async () => {
  ({ manualSync } = await import("./manualSync.js"));
});

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "apothecary-manualsync-test-"));
  await mkdir(abs("notes"), { recursive: true });
  await initChangeLog(`file:${path.join(vault, "change-log.db")}`);
  vi.stubEnv("APOTHECARY_HOME", vault);
  reindexFile.mockClear();
  removeFromIndex.mockClear();
  refreshSemantics.mockClear();
});

afterEach(async () => {
  setChangeLogClient(null);
  vi.unstubAllEnvs();
  await rm(vault, { recursive: true, force: true });
});

describe("manualSync", () => {
  it("discovers all markdown as created on the first sync and enqueues them", async () => {
    await writeFile(abs("notes/a.md"), "# A", "utf8");
    await writeFile(abs("notes/b.md"), "# B", "utf8");

    const report = await manualSync({ vaultPath: vault }, { refreshSemantics });

    expect(report).toMatchObject({ created: 2, modified: 0, deleted: 0, semanticRefreshed: true });
    const pending = await listPendingChanges();
    // The key win over the watcher: these are correctly typed `created`, not `modified`.
    expect(pending.map((p) => p.changeType).sort()).toEqual(["created", "created"]);
    expect(pending.every((p) => p.source === "manual")).toBe(true);
    expect(reindexFile).toHaveBeenCalledTimes(2);
    expect(refreshSemantics).toHaveBeenCalledOnce();
  });

  it("recovers created / modified / deleted against a prior snapshot", async () => {
    await writeFile(abs("notes/keep.md"), "v1", "utf8");
    await writeFile(abs("notes/gone.md"), "x", "utf8");
    await manualSync({ vaultPath: vault }, { refreshSemantics });

    await writeFile(abs("notes/keep.md"), "v2 changed", "utf8");
    await writeFile(abs("notes/new.md"), "new", "utf8");
    await unlink(abs("notes/gone.md"));

    const report = await manualSync({ vaultPath: vault }, { refreshSemantics });

    expect(report).toMatchObject({ created: 1, modified: 1, deleted: 1 });
    expect(reindexFile).toHaveBeenCalledWith("notes/keep.md");
    expect(reindexFile).toHaveBeenCalledWith("notes/new.md");
    expect(removeFromIndex).toHaveBeenCalledWith("notes/gone.md");

    const byPath = Object.fromEntries((await listPendingChanges()).map((c) => [c.path, c.changeType]));
    expect(byPath).toMatchObject({
      "notes/keep.md": "modified",
      "notes/new.md": "created",
      "notes/gone.md": "deleted",
    });
  });

  it("is a no-op (no reindex, no semantic refresh) when nothing changed", async () => {
    await writeFile(abs("notes/a.md"), "# A", "utf8");
    await manualSync({ vaultPath: vault }, { refreshSemantics });
    reindexFile.mockClear();
    refreshSemantics.mockClear();

    const report = await manualSync({ vaultPath: vault }, { refreshSemantics });

    expect(report).toMatchObject({ created: 0, modified: 0, deleted: 0, unchanged: 1, semanticRefreshed: false });
    expect(reindexFile).not.toHaveBeenCalled();
    expect(refreshSemantics).not.toHaveBeenCalled();
  });

  it("ignores the .agent and archive subtrees", async () => {
    await writeFile(abs("notes/real.md"), "# real", "utf8");
    await mkdir(abs("archive/notes"), { recursive: true });
    await writeFile(abs("archive/notes/old.md"), "archived", "utf8");

    const report = await manualSync({ vaultPath: vault }, { refreshSemantics });

    expect(report.created).toBe(1);
    expect((await listPendingChanges()).map((c) => c.path)).toEqual(["notes/real.md"]);
  });

  it("does not re-flag a system write once it is committed to the baseline, but still catches a later external edit", async () => {
    // A system op (executeIntake / resolveProposal) writes a note and records
    // its hash in the baseline — exactly what commitSelfWrite does at the end.
    await writeFile(abs("notes/sys.md"), "system-authored content", "utf8");
    await commitSelfWrite(vault, ["notes/sys.md"]);

    // The change detector (manual sync here; the watcher uses the same baseline)
    // sees it as already accounted for — no pending change.
    const afterSystemWrite = await manualSync({ vaultPath: vault }, { refreshSemantics });
    expect(afterSystemWrite).toMatchObject({ created: 0, modified: 0, deleted: 0 });
    expect(await listPendingChanges()).toHaveLength(0);

    // A genuine external edit did NOT sync its hash, so it is detected.
    await writeFile(abs("notes/sys.md"), "hand-edited by the user", "utf8");
    const afterExternalEdit = await manualSync({ vaultPath: vault }, { refreshSemantics });
    expect(afterExternalEdit).toMatchObject({ modified: 1 });
    const pending = await listPendingChanges();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ path: "notes/sys.md", changeType: "modified" });
  });
});
