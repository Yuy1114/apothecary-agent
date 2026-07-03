import { describe, expect, it } from "vitest";
import { addReadmeEntry, removeReadmeEntry, type ReadmeEntry } from "./readmeIndex.js";

const entry = (overrides: Partial<ReadmeEntry> = {}): ReadmeEntry => ({
  title: "Redis 持久化",
  fileName: "redis.md",
  date: "2026/7/3",
  label: "Redis",
  ...overrides,
});

describe("addReadmeEntry", () => {
  it("scaffolds a new README when there is none", () => {
    expect(addReadmeEntry(null, entry())).toBe(
      "# Redis\n\n## 笔记索引\n\n- [Redis 持久化](redis.md) — 2026/7/3\n",
    );
  });

  it("appends to an existing README", () => {
    const existing = "# Redis\n\n## 笔记索引\n\n- [Old](old.md) — 2026/7/1\n";
    expect(addReadmeEntry(existing, entry())).toBe(
      existing + "- [Redis 持久化](redis.md) — 2026/7/3\n",
    );
  });

  it("is idempotent when the file is already listed", () => {
    const existing = "## 笔记索引\n\n- [Redis 持久化](redis.md) — 2026/7/3\n";
    expect(addReadmeEntry(existing, entry())).toBe(existing);
  });

  it("does not treat a substring filename as already listed", () => {
    const existing = "## 笔记索引\n\n- [Other](aaa.md) — 2026/7/1\n";
    expect(addReadmeEntry(existing, entry({ fileName: "a.md" }))).toContain("(a.md)");
  });

  it("adds a separating newline when the content lacks a trailing one", () => {
    expect(addReadmeEntry("## 笔记索引", entry())).toBe(
      "## 笔记索引\n- [Redis 持久化](redis.md) — 2026/7/3\n",
    );
  });
});

describe("removeReadmeEntry", () => {
  it("removes the list line linking to the file", () => {
    const content = "## 笔记索引\n\n- [A](a.md) — d1\n- [B](b.md) — d2\n";
    expect(removeReadmeEntry(content, "a.md")).toBe("## 笔记索引\n\n- [B](b.md) — d2\n");
  });

  it("leaves content unchanged when the file is not listed", () => {
    const content = "## 笔记索引\n\n- [B](b.md) — d2\n";
    expect(removeReadmeEntry(content, "a.md")).toBe(content);
  });

  it("does not remove a non-list line that merely mentions the target", () => {
    const content = "See [A](a.md) inline.\n- [B](b.md) — d2\n";
    expect(removeReadmeEntry(content, "a.md")).toBe(content);
  });

  it("only removes the exact link target, not a substring match", () => {
    const content = "- [Long](aaa.md) — d\n- [Short](a.md) — d\n";
    expect(removeReadmeEntry(content, "a.md")).toBe("- [Long](aaa.md) — d\n");
  });
});
