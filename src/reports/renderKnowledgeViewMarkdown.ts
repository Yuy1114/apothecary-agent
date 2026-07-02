import type { KnowledgeView } from "../domain/knowledgeView.js";

function bulletList(items: string[], emptyText: string): string {
  if (items.length === 0) return emptyText;
  return items.map((item) => `- ${item}`).join("\n");
}

function orderedList(items: string[], emptyText: string): string {
  if (items.length === 0) return emptyText;
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

export function renderKnowledgeViewMarkdown(view: KnowledgeView): string {
  return [
    `# 知识体系：${view.topic}`,
    "",
    `_生成于 ${view.generatedAt}_`,
    "",
    "## 概述",
    "",
    view.overview || "（无）",
    "",
    "## 核心主题",
    "",
    bulletList(view.coreTopics, "（无）"),
    "",
    "## 关键概念",
    "",
    bulletList(view.keyConcepts, "（无）"),
    "",
    "## 当前缺口",
    "",
    bulletList(view.gaps, "（暂无识别到的缺口）"),
    "",
    "## 推荐阅读顺序",
    "",
    orderedList(view.readingOrder, "（无）"),
    "",
    "## 来源文件",
    "",
    bulletList(view.sourceFiles, "（无）"),
    "",
  ].join("\n");
}
