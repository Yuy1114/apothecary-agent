/**
 * End-to-end acceptance for post-apply refresh recovery: when the semantic
 * refresh fails after a proposal's file change already succeeded, the proposal
 * still applies, durable recovery work is recorded, and a retry drains it
 * without re-running the file mutation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSearchIndex, nullSearchIndex } from "../application/ports/searchIndex.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createProposal, loadProposal } from "../vault/proposalStore.js";
import {
  initChangeLog,
  setChangeLogClient,
  listPendingChanges,
} from "../vault/changeLog.js";
import { retrySemanticRecovery } from "../application/semantic/semanticRecovery.js";

const reindexFile = vi.fn(async () => ({ added: 1 }));
const removeFromIndex = vi.fn(async () => ({ removed: 0 }));
setSearchIndex({ ...nullSearchIndex, reindexFile, removeFromIndex });

let vault: string;
let resolveProposalById: typeof import("../application/proposals/resolveProposal.js").resolveProposalById;

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "apothecary-recovery-e2e-"));
  await initChangeLog(`file:${path.join(vault, "change-log.db")}`);
  vi.stubEnv("APOTHECARY_VAULT_PATH", vault);
  vi.stubEnv("APOTHECARY_HOME", vault);
  reindexFile.mockClear();
  ({ resolveProposalById } = await import("../application/proposals/resolveProposal.js"));
});

afterEach(async () => {
  setChangeLogClient(null);
  vi.unstubAllEnvs();
  await rm(vault, { recursive: true, force: true });
});

describe("post-apply recovery end-to-end", () => {
  it("applies the proposal, records recovery work on refresh failure, then a retry drains it", async () => {
    const proposal = await createProposal(vault, {
      type: "edit",
      title: "note",
      rationale: "r",
      payload: { filePath: "notes/a.md", suggestedContent: "# A\n\ncontent" },
    });

    // Post-apply refresh fails (e.g. the model was unreachable).
    const failingRefresh = vi.fn(async () => {
      throw new Error("summarizer down");
    });
    const result = await resolveProposalById(proposal.id, "approve", undefined, {
      postApplyRefresh: failingRefresh,
    });

    // The file change succeeded, so the proposal is applied...
    expect(result.status).toBe("applied");
    expect((await loadProposal(vault, proposal.id))?.status).toBe("applied");
    expect(await readFile(path.join(vault, "notes/a.md"), "utf8")).toBe("# A\n\ncontent");

    // ...but the stale semantic layer is captured as durable recovery work.
    const pending = await listPendingChanges();
    expect(pending).toEqual([
      expect.objectContaining({ path: "notes/a.md", source: "proposal", changeType: "modified" }),
    ]);

    // A retry (semantic refresh only) drains the work without re-writing the note.
    const writesBefore = reindexFile.mock.calls.length;
    const syncPaths = vi.fn(async () => ({}));
    const recovery = await retrySemanticRecovery({ vaultPath: vault }, { syncPaths });

    expect(recovery).toEqual({ pending: 1, resolved: 1 });
    expect(syncPaths).toHaveBeenCalledWith({ vaultPath: vault, paths: ["notes/a.md"] });
    expect(await listPendingChanges()).toEqual([]);
    // No further note mutation happened during recovery.
    expect(reindexFile.mock.calls.length).toBe(writesBefore);
    expect(await readFile(path.join(vault, "notes/a.md"), "utf8")).toBe("# A\n\ncontent");
  });
});
