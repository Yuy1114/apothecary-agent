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
  await mkdir(path.join(vault, ".agent"), { recursive: true });
  await writeFile(
    path.join(vault, ".agent", "structure.yaml"),
    "directories:\n  reflections/:\n    description: 反思\n    keywords:\n      - 反思\n  notes/:\n    description: 笔记\naliases: {}\n",
    "utf8",
  );
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

  it("approving a capture proposal writes a classified note", async () => {
    const p = await propose("capture", { content: "# 复盘\n\n今天的反思与总结", topic: "reflections/" });

    const result = await resolveProposalById(p.id, "approve");

    expect(result).toMatchObject({ resolved: true, type: "capture", status: "applied" });
    // Lands in the hinted directory and its README index is created.
    expect(await exists("reflections/README.md")).toBe(true);
  });

  it("approving a structure proposal adds keywords to structure.yaml", async () => {
    const p = await propose("structure", { directory: "reflections/", add: ["复盘"] });

    const result = await resolveProposalById(p.id, "approve");

    expect(result.status).toBe("applied");
    expect(await read(".agent/structure.yaml")).toContain("复盘");
  });

  it("leaves a structure proposal pending when the directory is unknown", async () => {
    const p = await propose("structure", { directory: "nope/", add: ["x"] });

    const result = await resolveProposalById(p.id, "approve");

    expect(result.resolved).toBe(false);
    expect(result.reason).toMatch(/not defined/);
    expect((await loadProposal(vault, p.id))?.status).toBe("proposed");
  });

  it("approving a view_promotion writes the target note", async () => {
    await mkdir(abs(".agent/views"), { recursive: true });
    await writeFile(abs(".agent/views/ai-eng.md"), "# view", "utf8");
    const p = await propose("view_promotion", {
      sourceViewPath: ".agent/views/ai-eng.md",
      targetPath: "notes/ai-eng.md",
      content: "# AI Engineering\n\npromoted",
    });

    const result = await resolveProposalById(p.id, "approve");

    expect(result.status).toBe("applied");
    expect(await read("notes/ai-eng.md")).toBe("# AI Engineering\n\npromoted");
  });

  it("refuses a view_promotion whose source view is missing", async () => {
    const p = await propose("view_promotion", {
      sourceViewPath: ".agent/views/ghost.md",
      targetPath: "notes/ghost.md",
      content: "x",
    });

    const result = await resolveProposalById(p.id, "approve");

    expect(result).toMatchObject({ resolved: false, reason: "missing_source_view" });
    expect(await exists("notes/ghost.md")).toBe(false);
  });

  it("leaves the proposal open when the executor fails (e.g. missing source)", async () => {
    const p = await propose("archive", { from: "notes/ghost.md" });

    const result = await resolveProposalById(p.id, "approve");

    expect(result).toMatchObject({ resolved: false, reason: "missing_source" });
    // Still pending, so it can be retried after fixing the cause.
    expect((await loadProposal(vault, p.id))?.status).toBe("proposed");
  });
});
