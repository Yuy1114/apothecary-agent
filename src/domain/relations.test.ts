import { describe, expect, it } from "vitest";
import { buildRelations } from "./relations.js";
import type { SemanticGraph } from "./semantic.js";
import type { DuplicateReport, DuplicateCluster } from "./duplicateDetection.js";

const graph = (topics: SemanticGraph["topics"], concepts: SemanticGraph["concepts"]): SemanticGraph => ({
  generatedAt: "t",
  topics,
  concepts,
});

const cluster = (over: Partial<DuplicateCluster> & Pick<DuplicateCluster, "files" | "classification">): DuplicateCluster => ({
  sharedTopics: [],
  sharedConcepts: [],
  recommendedAction: "",
  rationale: "",
  ...over,
});

const report = (clusters: DuplicateCluster[]): DuplicateReport => ({ generatedAt: "t", clusters });

describe("buildRelations", () => {
  it("emits related_to for a pair sharing enough concepts, weighting topics x2", () => {
    const g = graph(
      [{ label: "t1", files: ["a.md", "b.md"] }],
      [
        { label: "c1", files: ["a.md", "b.md"] },
        { label: "c2", files: ["a.md", "b.md"] },
      ],
    );
    const { relations } = buildRelations(g, report([]));
    expect(relations).toEqual([
      {
        from: "a.md",
        to: "b.md",
        type: "related_to",
        weight: 4, // 1 topic * 2 + 2 concepts
        sharedTopics: ["t1"],
        sharedConcepts: ["c1", "c2"],
      },
    ]);
  });

  it("drops pairs below the shared-concept threshold", () => {
    const g = graph([], [{ label: "c1", files: ["a.md", "b.md"] }]);
    expect(buildRelations(g, report([])).relations).toEqual([]);
  });

  it("retypes a related pair as duplicates for a harmful_duplicate cluster", () => {
    const g = graph(
      [],
      [
        { label: "c1", files: ["a.md", "b.md"] },
        { label: "c2", files: ["a.md", "b.md"] },
      ],
    );
    const r = buildRelations(g, report([cluster({ files: ["a.md", "b.md"], classification: "harmful_duplicate" })]));
    expect(r.relations[0]).toMatchObject({ from: "a.md", to: "b.md", type: "duplicates" });
  });

  it("adds a duplicate pair even when it did not meet the concept threshold", () => {
    const g = graph([], []);
    const r = buildRelations(
      g,
      report([
        cluster({
          files: ["x.md", "y.md"],
          classification: "evolutionary_duplicate",
          sharedConcepts: ["c1"],
        }),
      ]),
    );
    expect(r.relations).toHaveLength(1);
    expect(r.relations[0]).toMatchObject({ from: "x.md", to: "y.md", type: "evolves_with" });
  });

  it("maps contextual_repetition to related_to and ignores not_duplicate", () => {
    const g = graph([], []);
    const r = buildRelations(
      g,
      report([
        cluster({ files: ["a.md", "b.md"], classification: "contextual_repetition", sharedConcepts: ["c"] }),
        cluster({ files: ["c.md", "d.md"], classification: "not_duplicate", sharedConcepts: ["c"] }),
      ]),
    );
    expect(r.relations).toHaveLength(1);
    expect(r.relations[0]).toMatchObject({ from: "a.md", to: "b.md", type: "related_to" });
  });

  it("orders each pair canonically regardless of cluster file order", () => {
    const r = buildRelations(
      graph([], []),
      report([cluster({ files: ["z.md", "a.md"], classification: "harmful_duplicate" })]),
    );
    expect(r.relations[0]).toMatchObject({ from: "a.md", to: "z.md" });
  });
});
