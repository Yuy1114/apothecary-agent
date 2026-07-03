import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createProposal, loadProposal } from "../../vault/proposalStore.js";
import type { ProposalType } from "../../domain/proposal.js";

// Vector index is out of scope; stub every rag entry the action cores touch.
vi.mock("./rag.js", () => ({
  reindexFile: vi.fn(async () => ({ added: 0 })),
  removeFromIndex: vi.fn(async () => ({ removed: 0 })),
}));

let vault: string;
let resolveProposalById: typeof import("./resolve-proposal-core.js").resolveProposalById;

const abs = (rel: string) => path.join(vault, rel);
const read = (rel: string) => readFile(abs(rel), "utf8");
const exists = async (rel: string) =>
  access(abs(rel)).then(
    () => true,
    () => false,
  );

async function propose(type: ProposalType, payload: unknown, title = "t", rationale = "r") {
  return createProposal(vault, { type, title, rationale, payload });
}

beforeAll(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "apothecary-proposal-test-"));
  vi.stubEnv("APOTHECARY_VAULT_PATH", vault);
  ({ resolveProposalById } = await import("./resolve-proposal-core.js"));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(vault, { recursive: true, force: true });
});

describe("resolveProposalById", () => {
  it("approving an edit proposal writes the file and marks it applied", async () => {
    const p = await propose("edit", { filePath: "notes/a.md", suggestedContent: "# A\n\nnew" });

    const result = await resolveProposalById(p.id, "approve");

    expect(result).toMatchObject({ resolved: true, type: "edit", status: "applied" });
    expect(await read("notes/a.md")).toBe("# A\n\nnew");
    expect((await loadProposal(vault, p.id))?.status).toBe("applied");
  });

  it("approving a move proposal relocates the file", async () => {
    await mkdir(abs("inbox"), { recursive: true });
    await writeFile(abs("inbox/x.md"), "x", "utf8");
    const p = await propose("move", { from: "inbox/x.md", to: "notes/x.md" });

    const result = await resolveProposalById(p.id, "approve");

    expect(result.status).toBe("applied");
    expect(await exists("inbox/x.md")).toBe(false);
    expect(await exists("notes/x.md")).toBe(true);
  });

  it("approving an archive proposal retires the file under archive/", async () => {
    await mkdir(abs("notes"), { recursive: true });
    await writeFile(abs("notes/old.md"), "old", "utf8");
    const p = await propose("archive", { from: "notes/old.md" });

    await resolveProposalById(p.id, "approve");

    expect(await exists("notes/old.md")).toBe(false);
    expect(await exists("archive/notes/old.md")).toBe(true);
  });

  it("approving a merge proposal writes canonical and archives the source", async () => {
    await mkdir(abs("notes"), { recursive: true });
    await writeFile(abs("notes/keep.md"), "keep", "utf8");
    await writeFile(abs("notes/dupe.md"), "dupe", "utf8");
    const p = await propose("merge", {
      sourcePath: "notes/dupe.md",
      canonicalPath: "notes/keep.md",
      canonicalContent: "keep + merged",
    });

    await resolveProposalById(p.id, "approve");

    expect(await read("notes/keep.md")).toBe("keep + merged");
    expect(await exists("archive/notes/dupe.md")).toBe(true);
  });

  it("rejecting a proposal records the decision without touching files", async () => {
    const p = await propose("edit", { filePath: "notes/never.md", suggestedContent: "nope" });

    const result = await resolveProposalById(p.id, "reject", "not needed");

    expect(result).toMatchObject({ resolved: true, status: "rejected" });
    expect(await exists("notes/never.md")).toBe(false);
    const stored = await loadProposal(vault, p.id);
    expect(stored).toMatchObject({ status: "rejected", resolutionNote: "not needed" });
  });

  it("refuses to re-resolve an already-resolved proposal", async () => {
    const p = await propose("edit", { filePath: "notes/once.md", suggestedContent: "one" });
    await resolveProposalById(p.id, "approve");

    const again = await resolveProposalById(p.id, "approve");
    expect(again).toMatchObject({ resolved: false, reason: "not_pending", status: "applied" });
  });

  it("reports not_found for an unknown id", async () => {
    expect(await resolveProposalById("prop-nope", "approve")).toMatchObject({
      resolved: false,
      reason: "not_found",
    });
  });

  it("leaves the proposal open when the executor fails (e.g. missing source)", async () => {
    const p = await propose("archive", { from: "notes/ghost.md" });

    const result = await resolveProposalById(p.id, "approve");

    expect(result).toMatchObject({ resolved: false, reason: "missing_source" });
    // Still pending, so it can be retried after fixing the cause.
    expect((await loadProposal(vault, p.id))?.status).toBe("proposed");
  });
});
