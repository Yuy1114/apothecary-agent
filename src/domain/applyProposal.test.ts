import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyProposal } from "./applyProposal.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("applyProposal", () => {
  it("writes suggested content and marks the proposal applied", async () => {
    const vaultPath = await createTempVault();
    await writeProposal(vaultPath, {
      id: "edit-apply-001",
      filePath: "notes/nested/test.md",
      title: "Update test note",
      description: "Add detail",
      currentContent: "# Old",
      suggestedContent: "# New\n\nApplied content.",
      status: "proposed",
      createdAt: new Date().toISOString(),
    });

    const result = await applyProposal({ vaultPath, proposalId: "edit-apply-001" });

    expect(result).toMatchObject({
      proposalId: "edit-apply-001",
      filePath: "notes/nested/test.md",
      applied: true,
      status: "applied",
    });
    await expect(
      readFile(path.join(vaultPath, "notes/nested/test.md"), "utf8")
    ).resolves.toBe("# New\n\nApplied content.");

    const proposal = JSON.parse(
      await readFile(
        path.join(vaultPath, ".agent", "edits", "edit-apply-001.json"),
        "utf8"
      )
    );
    expect(proposal.status).toBe("applied");
  });

  it("throws when the proposal is not in 'proposed' state", async () => {
    const vaultPath = await createTempVault();
    await writeProposal(vaultPath, {
      id: "edit-apply-002",
      filePath: "notes/test.md",
      title: "Already applied",
      description: "Should not reapply",
      currentContent: "# Old",
      suggestedContent: "# New",
      status: "applied",
      createdAt: new Date().toISOString(),
    });

    await expect(
      applyProposal({ vaultPath, proposalId: "edit-apply-002" })
    ).rejects.toThrow(/already applied/);
  });
});

async function createTempVault(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "apothecary-apply-proposal-test-"));
  tempDirs.push(dir);
  return dir;
}

async function writeProposal(
  vaultPath: string,
  proposal: Record<string, unknown>
): Promise<void> {
  const editsDir = path.join(vaultPath, ".agent", "edits");
  await mkdir(editsDir, { recursive: true });
  await writeFile(
    path.join(editsDir, `${proposal.id}.json`),
    JSON.stringify(proposal),
    "utf8"
  );
}
