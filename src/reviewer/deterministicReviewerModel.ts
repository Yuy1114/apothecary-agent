import path from "node:path";
import type { KnowledgeMap, KnowledgeTopic } from "../domain/knowledgeMap.js";
import type { MaintenanceFinding, MaintenanceReview } from "../domain/maintenanceReview.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";
import type { KnowledgeMapInput, MaintenanceReviewInput, ReviewerModel } from "./reviewerModel.js";

export class DeterministicReviewerModel implements ReviewerModel {
  async generateKnowledgeMap(input: KnowledgeMapInput): Promise<KnowledgeMap> {
    const { scan, options } = input;
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
        relatedFiles: topic.relatedFiles.slice(0, options.maxFilesPerTopic),
        summary: `${topic.title} contains ${topic.relatedFiles.length} markdown file(s).`,
      }))
      .sort((a, b) => b.relatedFiles.length - a.relatedFiles.length)
      .slice(0, options.maxTopics);

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

  async generateMaintenanceReview(input: MaintenanceReviewInput): Promise<MaintenanceReview> {
    const { scan, options } = input;
    const findings: MaintenanceFinding[] = [];

    for (const file of scan.files.filter((candidate) => candidate.mediaType === "markdown")) {
      if (
        (file.wordCount ?? 0) > options.longContextWordThreshold ||
        (file.lineCount ?? 0) > options.longContextLineThreshold
      ) {
        findings.push({
          id: createId("finding"),
          type: "long_context",
          severity: "medium",
          filePaths: [file.path],
          observation: "This Markdown file is large enough to be expensive to re-read when returning to the topic.",
          whyItMatters: "Long context files increase recall cost and may benefit from a generated context summary.",
          suggestion: "Review whether this file needs a short topic summary or index note.",
          relatedFiles: [],
          confidence: 0.6,
        });
      }

      if (isLikelyAiOutput(file.path)) {
        findings.push({
          id: createId("finding"),
          type: "unassimilated_ai_output",
          severity: "medium",
          filePaths: [file.path],
          observation: "This file path suggests AI-generated or output material.",
          whyItMatters: "AI outputs often remain as temporary artifacts unless durable insights are absorbed into project or concept notes.",
          suggestion: "Check whether this output contains decisions, concepts, or project context worth integrating later.",
          relatedFiles: [],
          confidence: 0.45,
        });
      }

      if (path.basename(file.path).toLowerCase().includes("untitled")) {
        findings.push({
          id: createId("finding"),
          type: "unclear_location",
          severity: "low",
          filePaths: [file.path],
          observation: "The file name suggests this note may not have a stable title yet.",
          whyItMatters: "Unclear note names make later recall and topic grouping harder.",
          suggestion: "Manually review whether the note needs a clearer title or topic assignment.",
          relatedFiles: [],
          confidence: 0.5,
        });
      }
    }

    return {
      id: createId("review"),
      vaultPath: scan.vaultPath,
      scopePath: scan.scopePath,
      generatedAt: nowIso(),
      basedOnScanId: scan.id,
      findings,
      summary: `Found ${findings.length} maintenance finding(s) from ${scan.stats.markdownFiles} markdown file(s).`,
    };
  }
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

function isLikelyAiOutput(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.includes("output") || lower.includes("ai-generated") || lower.includes("chatgpt") || lower.includes("claude");
}
