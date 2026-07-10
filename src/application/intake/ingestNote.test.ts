import { describe, expect, it } from "vitest";
import { resolveIngestDir } from "./ingestNote.js";
import type { VaultStructure } from "../../domain/vaultStructure.js";

const structure: VaultStructure = {
  directories: {
    "inbox/": { description: "临时未归类，待整理" },
    "notes/programming/Redis/": { description: "Redis", keywords: ["redis", "缓存"] },
    "reflections/": { description: "反思、复盘、感想", keywords: ["感想", "反思"] },
  },
  aliases: {},
};

describe("resolveIngestDir", () => {
  it("uses an exact topic key when it matches a directory", () => {
    expect(resolveIngestDir(structure, { topic: "notes/programming/Redis/", content: "x" })).toEqual({
      dir: "notes/programming/Redis/",
      label: "Redis",
    });
  });

  it("matches a directory by keyword contained in the topic hint", () => {
    expect(resolveIngestDir(structure, { topic: "redis 持久化", content: "x" })).toEqual({
      dir: "notes/programming/Redis/",
      label: "Redis",
    });
  });

  it("classifies by content keywords when no topic hint resolves", () => {
    const r = resolveIngestDir(structure, { topic: undefined, content: "今天做了一些反思和复盘" });
    expect(r.dir).toBe("reflections/");
  });

  it("falls back to inbox when nothing matches", () => {
    expect(resolveIngestDir(structure, { topic: undefined, content: "无关内容 xyz" })).toEqual({
      dir: "inbox",
      label: "未分类",
    });
  });
});
