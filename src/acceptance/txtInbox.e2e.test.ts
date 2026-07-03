import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createProposal, loadProposal } from "../vault/proposalStore.js";
import { initOperationLedger, listOperations, setOperationLedgerClient } from "../vault/operationLedger.js";
import { readVaultText } from "../mastra/tools/read-vault-text.js";

const reindexFile = vi.fn(async () => ({ added: 0 }));
const removeFromIndex = vi.fn(async () => ({ removed: 0 }));
vi.mock("../mastra/tools/rag.js", () => ({ reindexFile, removeFromIndex }));

let vault: string;
let resolveProposalById: typeof import("../mastra/tools/resolve-proposal-core.js").resolveProposalById;
const abs = (rel: string) => path.join(vault, rel);

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "apothecary-txt-inbox-"));
  await mkdir(abs("inbox"), { recursive: true });
  await mkdir(abs("references"), { recursive: true });
  await writeFile(abs("inbox/redis.txt"), "Redis 复盘\nRDB 与 AOF 的取舍", "utf8");
  await initOperationLedger(`file:${path.join(vault, "operations.db")}`);
  vi.stubEnv("APOTHECARY_VAULT_PATH", vault);
  ({ resolveProposalById } = await import("../mastra/tools/resolve-proposal-core.js"));
});

afterEach(async () => {
  setOperationLedgerClient(null);
  vi.unstubAllEnvs();
  await rm(vault, { recursive: true, force: true });
});

describe("txt inbox triage end-to-end", () => {
  it("reads txt for classification and moves it only after proposal approval", async () => {
    const inspected = await readVaultText(vault, "inbox/redis.txt");
    expect(inspected).toMatchObject({ mediaType: "text", content: expect.stringContaining("RDB") });

    const proposal = await createProposal(vault, {
      type: "move",
      title: "归位 Redis 资料",
      rationale: "内容属于长期参考资料",
      payload: { from: "inbox/redis.txt", to: "references/redis.txt" },
    });
    await expect(access(abs("inbox/redis.txt"))).resolves.toBeUndefined();

    const result = await resolveProposalById(proposal.id, "approve", undefined, {
      postApplyRefresh: async () => undefined,
    });

    expect(result).toMatchObject({ resolved: true, status: "applied" });
    await expect(access(abs("inbox/redis.txt"))).rejects.toBeDefined();
    expect(await readFile(abs("references/redis.txt"), "utf8")).toBe(inspected.content);
    expect(reindexFile).not.toHaveBeenCalled();
    expect(removeFromIndex).not.toHaveBeenCalled();
    expect((await listOperations()).some((op) => op.type === "move")).toBe(true);
    expect((await loadProposal(vault, proposal.id))?.status).toBe("applied");
  });
});
