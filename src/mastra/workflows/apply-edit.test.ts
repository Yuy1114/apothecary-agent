import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyEditWorkflow } from "./apply-edit.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("applyEditWorkflow", () => {
  it("suspends for human approval before applying a proposal", async () => {
    const vaultPath = await createTempVault();
    await writeProposal(vaultPath, {
      id: "edit-approval-001",
      filePath: "notes/test.md",
      title: "Update test note",
      description: "Add more detail",
      currentContent: "# Old",
      suggestedContent: "# New\n\nApproved content.",
      status: "proposed",
      createdAt: new Date().toISOString(),
    });

    const run = await createApplyEditWorkflowRun();
    const result = await run.start({ inputData: { vaultPath, proposalId: "edit-approval-001" } });

    expect(result.status).toBe("suspended");
    if (result.status !== "suspended") return;
    expect(result.suspendPayload).toMatchObject({
      "request-edit-approval": {
        proposalId: "edit-approval-001",
        filePath: "notes/test.md",
        title: "Update test note",
      },
    });

    const resumed = await run.resume({ resumeData: { approved: true } });

    expect(resumed.status).toBe("success");
    if (resumed.status !== "success") return;
    expect(resumed.result.applied).toBe(true);
    await expect(readFile(path.join(vaultPath, "notes/test.md"), "utf8")).resolves.toBe("# New\n\nApproved content.");

    const proposal = JSON.parse(await readFile(path.join(vaultPath, ".agent", "edits", "edit-approval-001.json"), "utf8"));
    expect(proposal.status).toBe("applied");
  });

  it("leaves the proposal untouched when approval is declined", async () => {
    const vaultPath = await createTempVault();
    await writeProposal(vaultPath, {
      id: "edit-approval-002",
      filePath: "notes/test.md",
      title: "Decline test note",
      description: "Should not write",
      currentContent: "# Old",
      suggestedContent: "# New",
      status: "proposed",
      createdAt: new Date().toISOString(),
    });

    const run = await createApplyEditWorkflowRun();
    const result = await run.start({ inputData: { vaultPath, proposalId: "edit-approval-002" } });
    expect(result.status).toBe("suspended");

    const resumed = await run.resume({ resumeData: { approved: false } });

    expect(resumed.status).toBe("success");
    if (resumed.status !== "success") return;
    expect(resumed.result.applied).toBe(false);
    const proposal = JSON.parse(await readFile(path.join(vaultPath, ".agent", "edits", "edit-approval-002.json"), "utf8"));
    expect(proposal.status).toBe("proposed");
  });
});

async function createApplyEditWorkflowRun() {
  const mastra = new Mastra({
    workflows: { applyEditWorkflow },
    storage: new LibSQLStore({ id: "apothecary-apply-edit-workflow-test-storage", url: "file:./local.db" }),
  });
  const workflow = mastra.getWorkflow("applyEditWorkflow");
  return await workflow.createRun();
}

async function createTempVault(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "apothecary-apply-edit-workflow-test-"));
  tempDirs.push(dir);
  return dir;
}

async function writeProposal(vaultPath: string, proposal: Record<string, unknown>): Promise<void> {
  const editsDir = path.join(vaultPath, ".agent", "edits");
  await import("node:fs/promises").then((fs) => fs.mkdir(editsDir, { recursive: true }));
  await writeFile(path.join(editsDir, `${proposal.id}.json`), JSON.stringify(proposal), "utf8");
}
