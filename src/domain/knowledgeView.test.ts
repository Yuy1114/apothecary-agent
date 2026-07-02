import { describe, expect, it } from "vitest";
import { assembleViewFiles } from "./knowledgeView.js";
import { renderKnowledgeViewMarkdown } from "../reports/renderKnowledgeViewMarkdown.js";
import type { SemanticGraph } from "./semantic.js";
import type { KnowledgeView } from "./knowledgeView.js";

const graph: SemanticGraph = {
  generatedAt: "2026-07-02T00:00:00.000Z",
  topics: [
    { label: "Redis", files: ["notes/redis/a.md", "notes/redis/b.md"] },
    { label: "Redis Persistence", files: ["notes/redis/b.md"] },
    { label: "Java", files: ["notes/java/c.md"] },
  ],
  concepts: [{ label: "AOF", files: ["notes/redis/a.md"] }],
};

describe("assembleViewFiles", () => {
  it("collects files from topic/concept labels matching the query, deduped", () => {
    // "redis" matches "Redis" and "Redis Persistence"
    expect(assembleViewFiles(graph, "Redis")).toEqual(["notes/redis/a.md", "notes/redis/b.md"]);
  });

  it("matches when a graph label contains the query", () => {
    expect(assembleViewFiles(graph, "persistence")).toEqual(["notes/redis/b.md"]);
  });

  it("returns empty for an unknown topic", () => {
    expect(assembleViewFiles(graph, "kubernetes")).toEqual([]);
  });
});

describe("renderKnowledgeViewMarkdown", () => {
  it("renders all sections", () => {
    const view: KnowledgeView = {
      topic: "Redis",
      generatedAt: "2026-07-02T00:00:00.000Z",
      overview: "Redis 知识概述。",
      coreTopics: ["持久化", "缓存"],
      keyConcepts: ["AOF", "RDB"],
      gaps: ["缺少集群实践"],
      readingOrder: ["Redis.md", "持久化.md"],
      sourceFiles: ["notes/redis/a.md"],
    };
    const md = renderKnowledgeViewMarkdown(view);
    expect(md).toContain("# 知识体系：Redis");
    expect(md).toContain("## 概述");
    expect(md).toContain("## 核心主题");
    expect(md).toContain("## 关键概念");
    expect(md).toContain("## 当前缺口");
    expect(md).toContain("## 推荐阅读顺序");
    expect(md).toContain("## 来源文件");
    expect(md).toContain("notes/redis/a.md");
  });
});
