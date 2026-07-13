import { describe, expect, it } from "vitest";
import matter from "gray-matter";
import { setFrontmatterKey, getFrontmatterKey, addFrontmatterTagsPreserving } from "./frontmatter.js";

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

describe("addFrontmatterTagsPreserving", () => {
  const NOTE = "---\ntitle: 想法\ncreated: 2026-07-01\ntags:\n  - redis\n---\n# 想法\n\n正文\n";

  it("appends new tags without re-serializing other frontmatter keys", () => {
    const out = addFrontmatterTagsPreserving(NOTE, ["redis", "缓存"]);
    // The unquoted date must survive byte-for-byte (gray-matter round-trips it
    // into an ISO timestamp — the regression this helper exists to prevent).
    expect(out).toContain("created: 2026-07-01\n");
    expect(out).toContain("tags:\n  - redis\n  - 缓存\n");
    expect(out.endsWith("# 想法\n\n正文\n")).toBe(true);
  });

  it("returns content unchanged when every tag already exists", () => {
    expect(addFrontmatterTagsPreserving(NOTE, ["redis"])).toBe(NOTE);
  });

  it("adds a tags block when frontmatter has none", () => {
    const out = addFrontmatterTagsPreserving("---\ntitle: X\ncreated: 2026-07-01\n---\nbody\n", ["缓存"]);
    expect(out).toContain("created: 2026-07-01\n");
    expect(matter(out).data.tags).toEqual(["缓存"]);
  });

  it("falls back to the round-trip for notes without frontmatter or with inline tags", () => {
    expect(matter(addFrontmatterTagsPreserving("# 无 frontmatter\n\n正文", ["缓存"])).data.tags).toEqual(["缓存"]);
    const inline = "---\ntags: [redis]\n---\nbody";
    expect(matter(addFrontmatterTagsPreserving(inline, ["缓存"])).data.tags).toEqual(["redis", "缓存"]);
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
