import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createProposal, loadProposal } from "../vault/proposalStore.js";
import { initOperationLedger, listOperations, setOperationLedgerClient } from "../vault/operationLedger.js";

const reindexFile = vi.fn(async () => ({ added: 1 }));
const removeFromIndex = vi.fn(async () => ({ removed: 1 }));
vi.mock("../mastra/tools/rag.js", () => ({ reindexFile, removeFromIndex }));

let vault: string;
let resolveProposalById: typeof import("../mastra/tools/resolve-proposal-core.js").resolveProposalById;
const abs = (rel: string) => path.join(vault, rel);

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "apothecary-merge-e2e-"));
  await mkdir(abs("notes"), { recursive: true });
  await writeFile(abs("notes/copy.md"), "# Redis copy\n\nduplicate detail", "utf8");
  await writeFile(abs("notes/redis.md"), "# Redis\n\ncurrent", "utf8");
  await initOperationLedger(`file:${path.join(vault, "operations.db")}`);
  vi.stubEnv("APOTHECARY_VAULT_PATH", vault);
  vi.stubEnv("APOTHECARY_HOME", vault);
  ({ resolveProposalById } = await import("../mastra/tools/resolve-proposal-core.js"));
});

afterEach(async () => {
  setOperationLedgerClient(null);
  vi.unstubAllEnvs();
  await rm(vault, { recursive: true, force: true });
});

describe("duplicate merge/archive end-to-end", () => {
  it("merges into the canonical note and non-destructively archives the absorbed source", async () => {
    const proposal = await createProposal(vault, {
      type: "merge",
      title: "合并 Redis 重复笔记",
      rationale: "harmful duplicate",
      payload: {
        sourcePath: "notes/copy.md",
        canonicalPath: "notes/redis.md",
        canonicalContent: "# Redis\n\ncurrent\n\nduplicate detail",
      },
    });

    const result = await resolveProposalById(proposal.id, "approve", undefined, {
      postApplyRefresh: async () => undefined,
    });

    expect(result).toMatchObject({ resolved: true, status: "applied" });
    expect(await readFile(abs("notes/redis.md"), "utf8")).toContain("duplicate detail");
    await expect(access(abs("notes/copy.md"))).rejects.toBeDefined();
    await expect(access(abs("archive/notes/copy.md"))).resolves.toBeUndefined();
    expect(reindexFile).toHaveBeenCalledWith("notes/redis.md");
    expect(removeFromIndex).toHaveBeenCalledWith("notes/copy.md");
    const operations = await listOperations();
    expect(operations.some((op) => op.type === "merge")).toBe(true);
    expect((await loadProposal(vault, proposal.id))?.status).toBe("applied");
  });
});
