/**
 * End-to-end acceptance for the confirmed-change contract: approving a proposal
 * must leave the physical layer, README index, search index, semantic layer and
 * operation ledger all consistent, and the proposal marked applied.
 *
 * Everything is real (proposal store, executors, README indexing, operation
 * ledger, semantic pipeline) except the two external LLM boundaries: the vector
 * reindex (mocked, asserted called) and the summarizer (deterministic stub).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setSearchIndex, nullSearchIndex } from "../application/ports/searchIndex.js";
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createProposal, loadProposal } from "../vault/proposalStore.js";
import { loadSummaries } from "../vault/semanticStore.js";
import { loadSnapshot } from "../vault/syncSnapshot.js";
import {
  initOperationLedger,
  setOperationLedgerClient,
  listOperations,
} from "../vault/operationLedger.js";
import { syncSemanticsForPaths } from "../application/semantic/syncSemanticsFromChanges.js";

// Vector index is external — assert it is kept in sync, don't run it.
const reindexFile = vi.fn(async () => ({ added: 1 }));
const removeFromIndex = vi.fn(async () => ({ removed: 0 }));
setSearchIndex({ ...nullSearchIndex, reindexFile, removeFromIndex });

// Deterministic stand-in for the LLM summarizer used by the post-apply refresh.
const stubSummarize = (async (input: { path: string; title: string; contentHash: string }) => ({
  path: input.path,
  contentHash: input.contentHash,
  generatedAt: "2026-07-03T00:00:00.000Z",
  title: input.title,
  gist: `gist:${input.path}`,
  topics: ["Redis"],
  concepts: ["复盘"],
  summary: "s",
})) as unknown as typeof import("../application/semantic/generateFileSummary.js").generateFileSummary;

let vault: string;
let resolveProposalById: typeof import("../mastra/tools/resolve-proposal-core.js").resolveProposalById;

// Run the real semantic pipeline for the changed files, LLM stubbed.
const postApplyRefresh = (vaultPath: string, paths: string[]) =>
  syncSemanticsForPaths({ vaultPath, paths }, { summarize: stubSummarize });

beforeAll(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "apothecary-e2e-test-"));
  await writeFile(
    path.join(vault, "structure.yaml"),
    "directories:\n  reflections/:\n    description: 反思\n    keywords:\n      - 反思\n      - 复盘\naliases: {}\n",
    "utf8",
  );
  await initOperationLedger(`file:${path.join(vault, "operations.db")}`);
  vi.stubEnv("APOTHECARY_VAULT_PATH", vault);
  vi.stubEnv("APOTHECARY_HOME", vault);
  ({ resolveProposalById } = await import("../mastra/tools/resolve-proposal-core.js"));
});

afterAll(async () => {
  setOperationLedgerClient(null);
  vi.unstubAllEnvs();
  await rm(vault, { recursive: true, force: true });
});

describe("capture proposal end-to-end", () => {
  it("approving a capture keeps every layer consistent and marks it applied", async () => {
    const proposal = await createProposal(vault, {
      type: "capture",
      title: "Redis 复盘",
      rationale: "durable insight from the conversation",
      payload: { content: "# Redis 复盘\n\n今天关于 Redis 持久化的反思与复盘。", topic: "reflections/" },
    });
    expect(proposal.status).toBe("proposed");

    const result = await resolveProposalById(proposal.id, "approve", undefined, { postApplyRefresh });

    // Governance: proposal is applied and durably recorded as such.
    expect(result).toMatchObject({ resolved: true, type: "capture", status: "applied" });
    expect((await loadProposal(vault, proposal.id))?.status).toBe("applied");

    // Operation ledger: the capture is audited; use it as the source of truth
    // for where the note actually landed.
    const ops = await listOperations();
    const captureOp = ops.find((op) => op.type === "capture");
    expect(captureOp).toBeDefined();
    const notePath = captureOp!.targetFiles[0];
    expect(notePath.startsWith("reflections/")).toBe(true);

    // Physical layer: the note exists with the captured content.
    const noteBody = await readFile(path.join(vault, notePath), "utf8");
    expect(noteBody).toContain("今天关于 Redis 持久化的反思与复盘。");

    // README index: the directory index lists the new note.
    const readme = await readFile(path.join(vault, "reflections", "README.md"), "utf8");
    expect(readme).toContain(`(${path.posix.basename(notePath)})`);

    // Search index: the vector store was kept in sync for the new note.
    expect(reindexFile).toHaveBeenCalledWith(notePath);

    // Semantic layer: the post-apply refresh summarized the new note.
    const summaries = await loadSummaries(vault);
    expect(summaries[notePath]).toBeDefined();
    expect(summaries[notePath].topics).toContain("Redis");

    // ...and the derived artifacts were rebuilt (graph → relations exist on disk).
    await expect(access(path.join(vault, "semantic", "semantic-graph.json"))).resolves.toBeUndefined();

    // Sync baseline: BOTH the new note and the README it updated are folded into
    // the baseline, so the watcher / a later manual sync never re-flag the agent's
    // own capture as an external change (the README fold was previously missing).
    const snapshot = await loadSnapshot(vault);
    expect(snapshot.files[notePath]).toBeDefined();
    expect(snapshot.files["reflections/README.md"]).toBeDefined();
  });
});
