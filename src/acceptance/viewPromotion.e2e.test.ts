import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createProposal, loadProposal } from "../vault/proposalStore.js";
import { initOperationLedger, listOperations, setOperationLedgerClient } from "../vault/operationLedger.js";

const reindexFile = vi.fn(async () => ({ added: 1 }));
vi.mock("../mastra/tools/rag.js", () => ({
  reindexFile,
  removeFromIndex: vi.fn(async () => ({ removed: 0 })),
}));

let vault: string;
let resolveProposalById: typeof import("../mastra/tools/resolve-proposal-core.js").resolveProposalById;
const abs = (rel: string) => path.join(vault, rel);

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "apothecary-view-e2e-"));
  await mkdir(abs(".agent/views"), { recursive: true });
  await writeFile(abs(".agent/views/redis-system.md"), "# Redis System\n\nGenerated view", "utf8");
  await initOperationLedger(`file:${path.join(vault, "operations.db")}`);
  vi.stubEnv("APOTHECARY_VAULT_PATH", vault);
  ({ resolveProposalById } = await import("../mastra/tools/resolve-proposal-core.js"));
});

afterEach(async () => {
  setOperationLedgerClient(null);
  vi.unstubAllEnvs();
  await rm(vault, { recursive: true, force: true });
});

describe("view promotion end-to-end", () => {
  it("keeps a generated view agent-local until approval promotes it to the vault", async () => {
    const content = "# Redis 知识体系\n\nPromoted and reviewed";
    const proposal = await createProposal(vault, {
      type: "view_promotion",
      title: "沉淀 Redis 知识体系",
      rationale: "the generated view is durable",
      payload: {
        sourceViewPath: ".agent/views/redis-system.md",
        targetPath: "knowledge/redis-system.md",
        content,
      },
    });
    await expect(access(abs("knowledge/redis-system.md"))).rejects.toBeDefined();

    const result = await resolveProposalById(proposal.id, "approve", undefined, {
      postApplyRefresh: async () => undefined,
    });

    expect(result).toMatchObject({ resolved: true, status: "applied" });
    expect(await readFile(abs("knowledge/redis-system.md"), "utf8")).toBe(content);
    expect(await readFile(abs("knowledge/README.md"), "utf8")).toContain("(redis-system.md)");
    await expect(access(abs(".agent/views/redis-system.md"))).resolves.toBeUndefined();
    expect(reindexFile).toHaveBeenCalledWith("knowledge/redis-system.md");
    expect((await listOperations()).some((op) => op.type === "promote")).toBe(true);
    expect((await loadProposal(vault, proposal.id))?.status).toBe("applied");
  });
});
