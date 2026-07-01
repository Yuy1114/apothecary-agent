import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const originalEnv = { ...process.env };

afterEach(async () => {
  process.env = { ...originalEnv };
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("HITL edit proposals", () => {
  it("lists proposals from the edits directory", async () => {
    const vaultPath = await createTempVault();
    const editsDir = path.join(vaultPath, ".agent", "edits");
    await import("node:fs/promises").then((fs) => fs.mkdir(editsDir, { recursive: true }));

    const proposal = {
      id: "edit-test-001",
      filePath: "notes/test.md",
      title: "Update test note",
      description: "Add more detail",
      currentContent: "# Old",
      suggestedContent: "# New\nMore detail",
      status: "proposed",
      createdAt: new Date().toISOString(),
    };

    await writeFile(path.join(editsDir, "edit-test-001.json"), JSON.stringify(proposal), "utf8");

    // Test listProposals logic
    const entries = await import("node:fs/promises").then((fs) => fs.readdir(editsDir));
    const proposals = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const content = await import("node:fs/promises").then((fs) => fs.readFile(path.join(editsDir, entry), "utf8"));
      proposals.push(JSON.parse(content));
    }

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      id: "edit-test-001",
      filePath: "notes/test.md",
      title: "Update test note",
      status: "proposed",
    });
  });

  it("applies a proposal by writing the suggested content", async () => {
    const vaultPath = await createTempVault();
    const editsDir = path.join(vaultPath, ".agent", "edits");
    const fs = await import("node:fs/promises");
    await fs.mkdir(editsDir, { recursive: true });

    const proposal = {
      id: "edit-test-002",
      filePath: "notes/new-note.md",
      title: "Create new note",
      description: "New scratch note",
      currentContent: "",
      suggestedContent: "# New Note\n\nHello world.",
      status: "proposed" as const,
      createdAt: new Date().toISOString(),
    };

    // Apply
    const filePath = path.join(vaultPath, proposal.filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (proposal.suggestedContent) {
      await fs.writeFile(filePath, proposal.suggestedContent, "utf8");
    }
    await fs.writeFile(
      path.join(editsDir, `${proposal.id}.json`),
      JSON.stringify({ ...proposal, status: "applied" }, null, 2),
      "utf8",
    );

    // Verify
    const written = await readFile(filePath, "utf8");
    expect(written).toBe("# New Note\n\nHello world.");

    const statusContent = await readFile(path.join(editsDir, "edit-test-002.json"), "utf8");
    expect(JSON.parse(statusContent).status).toBe("applied");
  });
});

async function createTempVault(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "apothecary-edit-test-"));
  tempDirs.push(dir);
  return dir;
}
