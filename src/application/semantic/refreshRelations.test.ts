import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { refreshRelations } from "./refreshRelations.js";
import { loadRelations, loadCanonicalCandidates } from "../../vault/semanticStore.js";
import { getAgentArtifacts } from "../../artifacts/agentArtifacts.js";
import type { SemanticGraph } from "../../domain/semantic.js";
import type { DuplicateReport } from "../../domain/duplicateDetection.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function freshVault(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "apothecary-relations-test-"));
  dirs.push(dir);
  return dir;
}

async function writeDupReport(vault: string, report: DuplicateReport): Promise<void> {
  const semanticDir = getAgentArtifacts(vault).semanticDir;
  await mkdir(semanticDir, { recursive: true });
  await writeFile(path.join(semanticDir, "duplicate-clusters.json"), JSON.stringify(report), "utf8");
}

const graph: SemanticGraph = {
  generatedAt: "t",
  topics: [],
  concepts: [
    { label: "c1", files: ["a.md", "b.md"] },
    { label: "c2", files: ["a.md", "b.md"] },
  ],
};

describe("refreshRelations", () => {
  it("builds related_to relations from the graph and persists them", async () => {
    const vault = await freshVault();
    const result = await refreshRelations(vault, graph);
    expect(result.relations).toBe(1);

    const { relations } = await loadRelations(vault);
    expect(relations[0]).toMatchObject({ from: "a.md", to: "b.md", type: "related_to" });
  });

  it("also persists canonical candidates for concepts spread across enough files", async () => {
    const vault = await freshVault();
    const spread: SemanticGraph = {
      generatedAt: "t",
      topics: [],
      concepts: [{ label: "c1", files: ["a.md", "b.md", "c.md"] }],
    };

    const result = await refreshRelations(vault, spread);

    expect(result.canonicalCandidates).toBe(1);
    const { candidates } = await loadCanonicalCandidates(vault);
    expect(candidates[0]).toMatchObject({ concept: "c1", fileCount: 3 });
  });

  it("folds an existing duplicate report into the relation types", async () => {
    const vault = await freshVault();
    await writeDupReport(vault, {
      generatedAt: "t",
      clusters: [
        {
          files: ["a.md", "b.md"],
          sharedTopics: [],
          sharedConcepts: ["c1", "c2"],
          classification: "harmful_duplicate",
          recommendedAction: "",
          rationale: "",
        },
      ],
    });

    await refreshRelations(vault, graph);

    const { relations } = await loadRelations(vault);
    expect(relations[0]).toMatchObject({ from: "a.md", to: "b.md", type: "duplicates" });
  });
});
