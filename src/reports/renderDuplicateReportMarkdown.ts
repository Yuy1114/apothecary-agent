import type { DuplicateCluster, DuplicateReport, DuplicateClassification } from "../domain/duplicateDetection.js";

const HEADINGS: Record<DuplicateClassification, string> = {
  harmful_duplicate: "有害重复（Harmful Duplicate）",
  contextual_repetition: "上下文重复（Contextual Repetition）",
  evolutionary_duplicate: "演化重复（Evolutionary Duplicate）",
  not_duplicate: "非重复（仅共享概念）",
};

const ORDER: DuplicateClassification[] = [
  "harmful_duplicate",
  "evolutionary_duplicate",
  "contextual_repetition",
  "not_duplicate",
];

function renderCluster(cluster: DuplicateCluster): string {
  return [
    `- **${cluster.files[0]}**  ↔  **${cluster.files[1]}**`,
    `  - 共享概念：${cluster.sharedConcepts.join(", ") || "（无）"}`,
    `  - 推荐动作：${cluster.recommendedAction}`,
    `  - 理由：${cluster.rationale}`,
  ].join("\n");
}

export function renderDuplicateReportMarkdown(report: DuplicateReport): string {
  const lines: string[] = ["# 重复检测报告", "", `_生成于 ${report.generatedAt}_`, ""];

  for (const classification of ORDER) {
    const clusters = report.clusters.filter((c) => c.classification === classification);
    if (clusters.length === 0) continue;
    lines.push(`## ${HEADINGS[classification]}（${clusters.length}）`, "");
    for (const cluster of clusters) lines.push(renderCluster(cluster), "");
  }

  if (report.clusters.length === 0) lines.push("（未发现重复候选。）", "");
  return lines.join("\n");
}
