import { describe, expect, it } from "vitest";
import matter from "gray-matter";
import { setFrontmatterKey, getFrontmatterKey } from "./frontmatter.js";

describe("setFrontmatterKey", () => {
  it("adds a key to a note that already has frontmatter, preserving the body", () => {
    const input = "---\ntitle: Old Note\n---\n\nBody stays.\n";
    const out = setFrontmatterKey(input, "superseded_by", "notes/canonical.md");
    const parsed = matter(out);
    expect(parsed.data).toMatchObject({ title: "Old Note", superseded_by: "notes/canonical.md" });
    expect(parsed.content.trim()).toBe("Body stays.");
  });

  it("scaffolds frontmatter for a note that has none", () => {
    const out = setFrontmatterKey("# Just a heading\n\ntext", "superseded_by", "notes/c.md");
    const parsed = matter(out);
    expect(parsed.data.superseded_by).toBe("notes/c.md");
    expect(parsed.content).toContain("# Just a heading");
  });

  it("overwrites an existing value for the same key", () => {
    const input = "---\nsuperseded_by: notes/first.md\n---\nx";
    const out = setFrontmatterKey(input, "superseded_by", "notes/second.md");
    expect(matter(out).data.superseded_by).toBe("notes/second.md");
  });
});

describe("getFrontmatterKey", () => {
  it("reads an existing key", () => {
    expect(getFrontmatterKey("---\nsuperseded_by: notes/c.md\n---\nx", "superseded_by")).toBe("notes/c.md");
  });

  it("returns undefined when the key or frontmatter is absent", () => {
    expect(getFrontmatterKey("# no frontmatter", "superseded_by")).toBeUndefined();
    expect(getFrontmatterKey("---\ntitle: X\n---\nx", "superseded_by")).toBeUndefined();
  });
});
