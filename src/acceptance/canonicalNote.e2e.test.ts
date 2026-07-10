/**
 * End-to-end acceptance for canonicalization: approving a canonical_note writes
 * the canonical note, stamps `superseded_by` on the sources, keeps the index and
 * semantic layer consistent, audits it, and the superseded notes then surface in
 * the maintenance-findings worklist (canonicalize → mark superseded → archive).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSearchIndex, nullSearchIndex } from "../application/ports/searchIndex.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { createProposal, loadProposal } from "../vault/proposalStore.js";
import { loadSummaries } from "../vault/semanticStore.js";
import {
  initOperationLedger,
  setOperationLedgerClient,
  listOperations,
} from "../vault/operationLedger.js";
import { detectSupersededNotes } from "../application/maintenance/detectSupersededNotes.js";
import { syncSemanticsForPaths } from "../application/semantic/syncSemanticsFromChanges.js";

const reindexFile = vi.fn(async () => ({ added: 1 }));
const removeFromIndex = vi.fn(async () => ({ removed: 0 }));
setSearchIndex({ ...nullSearchIndex, reindexFile, removeFromIndex });

const stubSummarize = (async (input: { path: string; title: string; contentHash: string }) => ({
  path: input.path,
  contentHash: input.contentHash,
  generatedAt: "2026-07-03T00:00:00.000Z",
  title: input.title,
  gist: `gist:${input.path}`,
  topics: ["Redis"],
  concepts: ["持久化"],
  summary: "s",
})) as unknown as typeof import("../application/semantic/generateFileSummary.js").generateFileSummary;

const postApplyRefresh = (vaultPath: string, paths: string[]) =>
  syncSemanticsForPaths({ vaultPath, paths }, { summarize: stubSummarize });

let vault: string;
let resolveProposalById: typeof import("../application/proposals/resolveProposal.js").resolveProposalById;
const abs = (rel: string) => path.join(vault, rel);

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "apothecary-canonical-e2e-"));
  await mkdir(abs("notes"), { recursive: true });
  await writeFile(abs("notes/redis-a.md"), "# Redis A\n\nearly notes on persistence", "utf8");
  await writeFile(abs("notes/redis-b.md"), "# Redis B\n\nmore persistence notes", "utf8");
  await initOperationLedger(`file:${path.join(vault, "operations.db")}`);
  reindexFile.mockClear();
  vi.stubEnv("APOTHECARY_VAULT_PATH", vault);
  vi.stubEnv("APOTHECARY_HOME", vault);
  ({ resolveProposalById } = await import("../application/proposals/resolveProposal.js"));
});

afterEach(async () => {
  setOperationLedgerClient(null);
  vi.unstubAllEnvs();
  await rm(vault, { recursive: true, force: true });
});

describe("canonical note end-to-end", () => {
  it("writes the canonical note, marks sources superseded, and surfaces them for archiving", async () => {
    const proposal = await createProposal(vault, {
      type: "canonical_note",
      title: "Redis persistence — canonical",
      rationale: "consolidate scattered Redis notes",
      payload: {
        canonicalPath: "notes/redis.md",
        content: "# Redis Persistence\n\nthe canonical, current take",
        supersedes: ["notes/redis-a.md", "notes/redis-b.md"],
      },
    });

    const result = await resolveProposalById(proposal.id, "approve", undefined, { postApplyRefresh });
    expect(result).toMatchObject({ resolved: true, type: "canonical_note", status: "applied" });

    // Canonical note written; sources stamped with a directed superseded_by link.
    expect(await readFile(abs("notes/redis.md"), "utf8")).toContain("canonical, current take");
    expect(matter(await readFile(abs("notes/redis-a.md"), "utf8")).data.superseded_by).toBe("notes/redis.md");
    expect(matter(await readFile(abs("notes/redis-b.md"), "utf8")).data.superseded_by).toBe("notes/redis.md");

    // Index + semantic layer + audit.
    expect(reindexFile).toHaveBeenCalledWith("notes/redis.md");
    expect((await loadSummaries(vault))["notes/redis.md"]).toBeDefined();
    expect((await listOperations()).some((op) => op.type === "canonical")).toBe(true);
    expect((await loadProposal(vault, proposal.id))?.status).toBe("applied");

    // The superseded, still-active notes now surface in the maintenance worklist.
    const superseded = await detectSupersededNotes(vault);
    expect(superseded.map((s) => s.path).sort()).toEqual(["notes/redis-a.md", "notes/redis-b.md"]);
  });
});
