import { describe, expect, it } from "vitest";
import { labelForDir, normalizeTopicDir } from "./ingestNote.js";
import { INBOX_DIR } from "../../domain/vaultPolicy.js";

describe("normalizeTopicDir", () => {
  it("accepts a plain vault-relative directory", () => {
    expect(normalizeTopicDir("notes")).toBe("notes");
    expect(normalizeTopicDir("areas/career")).toBe("areas/career");
  });

  it("tolerates trailing slashes, leading slashes and backslashes", () => {
    expect(normalizeTopicDir("notes/")).toBe("notes");
    expect(normalizeTopicDir("/notes/")).toBe("notes");
    expect(normalizeTopicDir("areas\\career")).toBe("areas/career");
  });

  it("rejects hints that are not usable directories", () => {
    expect(normalizeTopicDir(undefined)).toBeNull();
    expect(normalizeTopicDir("")).toBeNull();
    expect(normalizeTopicDir("   ")).toBeNull();
    // A file, not a directory.
    expect(normalizeTopicDir("notes/redis.md")).toBeNull();
    // Traversal — the hint comes from an LLM and is untrusted.
    expect(normalizeTopicDir("../outside")).toBeNull();
    expect(normalizeTopicDir("notes/../../etc")).toBeNull();
    expect(normalizeTopicDir("./notes")).toBeNull();
  });

  it("passes through a nonexistent directory unchanged — existence is checked later", () => {
    // normalizeTopicDir only sanitizes. `reflections/` no longer exists in the
    // skeleton, and resolveTargetDir is what redirects it to the inbox.
    expect(normalizeTopicDir("reflections/")).toBe("reflections");
  });
});

describe("labelForDir", () => {
  it("labels the inbox as unfiled", () => {
    expect(labelForDir(INBOX_DIR)).toBe("未分类");
  });

  it("uses the last path segment for everything else", () => {
    expect(labelForDir("notes")).toBe("notes");
    expect(labelForDir("areas/career")).toBe("career");
  });
});
