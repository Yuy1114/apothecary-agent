import { describe, expect, it } from "vitest";
import { demoteSuperseded } from "./rag.js";

describe("demoteSuperseded", () => {
  it("moves superseded results after current ones, preserving relative order", () => {
    const input = [
      { source: "a.md" },
      { source: "old.md", supersededBy: "canonical.md" },
      { source: "b.md" },
    ];
    expect(demoteSuperseded(input).map((r) => r.source)).toEqual(["a.md", "b.md", "old.md"]);
  });

  it("is a no-op when nothing is superseded", () => {
    const input: { source: string; supersededBy?: string }[] = [{ source: "a.md" }, { source: "b.md" }];
    expect(demoteSuperseded(input).map((r) => r.source)).toEqual(["a.md", "b.md"]);
  });
});
