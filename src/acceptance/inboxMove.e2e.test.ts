/**
 * End-to-end acceptance for inbox triage: approving a move proposal relocates
 * the note and keeps the source/target README indexes, the search index, the
 * semantic layer and the operation ledger consistent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSearchIndex, nullSearchIndex } from "../application/ports/searchIndex.js";
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createProposal, loadProposal } from "../vault/proposalStore.js";
import { loadSummaries } from "../vault/semanticStore.js";
import {
  initOperationLedger,
  setOperationLedgerClient,
  listOperations,
} from "../vault/operationLedger.js";
import { syncSemanticsForPaths } from "../application/semantic/syncSemanticsFromChanges.js";

const reindexFile = vi.fn(async () => ({ added: 1 }));
const removeFromIndex = vi.fn(async () => ({ removed: 1 }));
setSearchIndex({ ...nullSearchIndex, reindexFile, removeFromIndex });

const stubSummarize = (async (input: { path: string; title: string; contentHash: string }) => ({
  path: input.path,
  contentHash: input.contentHash,
  generatedAt: "2026-07-03T00:00:00.000Z",
  title: input.title,
  gist: `gist:${input.path}`,
  topics: ["t"],
  concepts: ["c"],
  summary: "s",
})) as unknown as typeof import("../application/semantic/generateFileSummary.js").generateFileSummary;

const postApplyRefresh = (vaultPath: string, paths: string[]) =>
  syncSemanticsForPaths({ vaultPath, paths }, { summarize: stubSummarize });

let vault: string;
let resolveProposalById: typeof import("../application/proposals/resolveProposal.js").resolveProposalById;
const abs = (rel: string) => path.join(vault, rel);

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "apothecary-move-e2e-"));
  await mkdir(abs("inbox"), { recursive: true });
  await mkdir(abs("notes"), { recursive: true });
  await writeFile(abs("inbox/idea.md"), "# Idea\n\na captured idea", "utf8");
  await writeFile(abs("inbox/README.md"), "## 笔记索引\n\n- [Idea](idea.md) — 2026/7/1\n", "utf8");
  await initOperationLedger(`file:${path.join(vault, "operations.db")}`);
  reindexFile.mockClear();
  removeFromIndex.mockClear();
  vi.stubEnv("APOTHECARY_VAULT_PATH", vault);
  vi.stubEnv("APOTHECARY_HOME", vault);
  ({ resolveProposalById } = await import("../application/proposals/resolveProposal.js"));
});

afterEach(async () => {
  setOperationLedgerClient(null);
  vi.unstubAllEnvs();
  await rm(vault, { recursive: true, force: true });
});

describe("inbox move end-to-end", () => {
  it("approving a move relocates the note and keeps every layer consistent", async () => {
    const proposal = await createProposal(vault, {
      type: "move",
      title: "file the idea",
      rationale: "belongs in notes",
      payload: { from: "inbox/idea.md", to: "notes/idea.md" },
    });

    // Before approval nothing moves.
    expect(await access(abs("inbox/idea.md")).then(() => true)).toBe(true);

    const result = await resolveProposalById(proposal.id, "approve", undefined, { postApplyRefresh });
    expect(result).toMatchObject({ resolved: true, status: "applied" });

    // Physical: source gone, target present.
    await expect(access(abs("inbox/idea.md"))).rejects.toBeDefined();
    expect(await readFile(abs("notes/idea.md"), "utf8")).toContain("a captured idea");

    // README indexes: source link removed, target link added.
    expect(await readFile(abs("inbox/README.md"), "utf8")).not.toContain("(idea.md)");
    expect(await readFile(abs("notes/README.md"), "utf8")).toContain("(idea.md)");

    // Search index kept in sync both ways.
    expect(removeFromIndex).toHaveBeenCalledWith("inbox/idea.md");
    expect(reindexFile).toHaveBeenCalledWith("notes/idea.md");

    // Semantic layer: the destination is summarized.
    expect((await loadSummaries(vault))["notes/idea.md"]).toBeDefined();

    // Audit + governance.
    expect((await listOperations()).some((op) => op.type === "move")).toBe(true);
    expect((await loadProposal(vault, proposal.id))?.status).toBe("applied");
  });
});
