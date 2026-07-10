import { describe, expect, it } from "vitest";
import { planReorg } from "./reorgPlan.js";
import type { VaultStructure } from "./vaultStructure.js";

const structure: VaultStructure = {
  directories: {
    "notes/programming/Data Structures & Algorithms/": { description: "DSA" },
    "notes/programming/Redis/": { description: "Redis" },
    "logs/": { description: "logs" },
  },
  aliases: {
    "notes/programming/dsa/": "notes/programming/Data Structures & Algorithms/",
  },
};

describe("planReorg", () => {
  it("rewrites alias prefixes, preserving nested sub-paths", () => {
    const plan = planReorg(
      [
        { path: "notes/programming/dsa/Tree/bfs.md" },
        { path: "notes/programming/dsa/intro.md" },
      ],
      structure,
    );

    expect(plan.moves).toEqual([
      { from: "notes/programming/dsa/Tree/bfs.md", to: "notes/programming/Data Structures & Algorithms/Tree/bfs.md" },
      { from: "notes/programming/dsa/intro.md", to: "notes/programming/Data Structures & Algorithms/intro.md" },
    ]);
    expect(plan.collisions).toHaveLength(0);
  });

  it("flags collisions instead of overwriting an existing target", () => {
    const plan = planReorg(
      [
        { path: "notes/programming/dsa/intro.md" },
        { path: "notes/programming/Data Structures & Algorithms/intro.md" },
      ],
      structure,
    );

    expect(plan.moves).toHaveLength(0);
    expect(plan.collisions).toEqual([
      {
        from: "notes/programming/dsa/intro.md",
        to: "notes/programming/Data Structures & Algorithms/intro.md",
      },
    ]);
  });

  it("flags a collision when two sources map to the same target", () => {
    const plan = planReorg(
      [
        { path: "notes/programming/dsa/x.md" },
        { path: "notes/programming/dsa/x.md" }, // duplicate target
      ],
      structure,
    );
    expect(plan.moves).toHaveLength(1);
    expect(plan.collisions).toHaveLength(1);
  });

  it("leaves canonical files unchanged and reports unclassified ones", () => {
    const plan = planReorg(
      [
        { path: "notes/programming/Redis/rdb.md" }, // canonical, unchanged
        { path: "logs/2026-07.md" }, // canonical, unchanged
        { path: "random/orphan.md" }, // no dir, no alias → unclassified
      ],
      structure,
    );

    expect(plan.moves).toHaveLength(0);
    expect(plan.unchangedCount).toBe(3);
    expect(plan.unclassified).toEqual(["random/orphan.md"]);
  });
});
