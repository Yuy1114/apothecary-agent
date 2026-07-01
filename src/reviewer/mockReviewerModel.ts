import path from "node:path";
import type { KnowledgeMap, KnowledgeTopic } from "../domain/knowledgeMap.js";
import type { VaultScan } from "../domain/vault.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";

export function buildDeterministicKnowledgeMap(scan: VaultScan): KnowledgeMap {
  const topicMap = new Map<string, KnowledgeTopic>();

  for (const file of scan.files.filter((candidate) => candidate.mediaType === "markdown")) {
    const topicTitle = inferTopicTitle(file.path);
    const existing = topicMap.get(topicTitle) ?? {
      id: createId("topic"),
      title: topicTitle,
      category: inferCategory(file.path),
      summary: `Files grouped under ${topicTitle}.`,
      keyConcepts: [],
      relatedFiles: [],
      openQuestions: [],
      confidence: 0.5,
    };

    existing.relatedFiles.push({
      path: file.path,
      title: file.title ?? path.basename(file.path, path.extname(file.path)),
      summary: buildFileSummary(file),
      role: inferRole(file.path),
      relevance: 0.5,
    });
    topicMap.set(topicTitle, existing);
  }

  const topics = [...topicMap.values()]
    .map((topic) => ({
      ...topic,
      relatedFiles: topic.relatedFiles.slice(0, 12),
      summary: `${topic.title} contains ${topic.relatedFiles.length} markdown file(s).`,
    }))
    .sort((a, b) => b.relatedFiles.length - a.relatedFiles.length)
    .slice(0, 20);

  return {
    id: createId("map"),
    vaultPath: scan.vaultPath,
    scopePath: scan.scopePath,
    generatedAt: nowIso(),
    basedOnScanId: scan.id,
    topics,
    summary: `Generated ${topics.length} topic candidate(s) from ${scan.stats.markdownFiles} markdown file(s).`,
  };
}

function inferTopicTitle(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, 2).join("/");
  return parts[0] ?? "root";
}

function inferCategory(filePath: string): KnowledgeTopic["category"] {
  const lower = filePath.toLowerCase();
  if (lower.includes("project")) return "project";
  if (lower.includes("course") || lower.includes("learn") || lower.includes("学习")) return "course";
  if (lower.includes("reflection") || lower.includes("感受") || lower.includes("diary")) return "reflection";
  return "unknown";
}

function inferRole(filePath: string): KnowledgeTopic["relatedFiles"][number]["role"] {
  const lower = filePath.toLowerCase();
  if (lower.includes("readme") || lower.includes("index")) return "index";
  if (lower.includes("vision") || lower.includes("prd") || lower.includes("overview")) return "overview";
  if (lower.includes("decision") || lower.includes("adr")) return "decision";
  if (lower.includes("draft") || lower.includes("temp")) return "draft";
  return "unknown";
}

function buildFileSummary(file: { lineCount?: number; wordCount?: number; layer: string }): string {
  const details = [
    file.lineCount === undefined ? undefined : `${file.lineCount} lines`,
    file.wordCount === undefined ? undefined : `${file.wordCount} words/chars`,
    `layer: ${file.layer}`,
  ].filter(Boolean);
  return details.join(", ");
}
