import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { applyKeywordEdit } from "./vault-structure.js";

const sample = `# vault structure
directories:
  reflections/:
    description: "反思、复盘、感想"
    keywords: [感想, 反思]

  notes/programming/Redis/:
    description: "Redis"
    keywords: [redis, 缓存]

aliases:
  notes/programming/dsa/: notes/programming/Data Structures & Algorithms/
`;

describe("applyKeywordEdit", () => {
  it("adds keywords and preserves comments/aliases", () => {
    const result = applyKeywordEdit(sample, { directory: "reflections/", add: ["感悟", "想通了"] });

    expect(result.keywords).toEqual(["感想", "反思", "感悟", "想通了"]);
    expect(result.conflicts).toEqual([]);
    expect(result.yaml).toContain("# vault structure"); // comment preserved
    const parsed = parse(result.yaml);
    expect(parsed.directories["reflections/"].keywords).toContain("想通了");
    expect(parsed.aliases["notes/programming/dsa/"]).toBe(
      "notes/programming/Data Structures & Algorithms/",
    ); // untouched
  });

  it("removes keywords and dedupes case-insensitively", () => {
    const result = applyKeywordEdit(sample, {
      directory: "notes/programming/Redis/",
      add: ["Redis"], // already present (case-insensitive) → no dup
      remove: ["缓存"],
    });
    expect(result.keywords).toEqual(["redis"]);
  });

  it("flags an added keyword that already belongs to another directory", () => {
    const result = applyKeywordEdit(sample, { directory: "reflections/", add: ["redis"] });
    expect(result.conflicts).toEqual(["redis"]);
  });

  it("throws for an unknown directory", () => {
    expect(() => applyKeywordEdit(sample, { directory: "does/not/exist/", add: ["x"] })).toThrow(
      /not defined/,
    );
  });
});
