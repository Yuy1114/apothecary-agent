import { describe, expect, it } from "vitest";
import { renderKnowledgeViewMarkdown } from "./renderKnowledgeViewMarkdown.js";
import type { KnowledgeView } from "../domain/knowledgeView.js";

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
