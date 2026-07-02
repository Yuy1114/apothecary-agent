import path from "node:path";
import type { KnowledgeMap, KnowledgeTopic } from "../../domain/knowledgeMap.js";
import type { MaintenanceFinding, MaintenanceReview } from "../../domain/maintenanceReview.js";
import { createId } from "../../utils/ids.js";
import { nowIso } from "../../utils/time.js";
import type { ReviewerFileContext } from "./reviewerContext.js";
import type { KnowledgeMapInput, MaintenanceReviewInput, ReviewerModel } from "./reviewerModel.js";

const INDEX_FILE_NAMES = new Set([
  "readme.md",
  "index.md",
  "_index.md",
  "overview.md",
  "概览.md",
  "总览.md",
  "入口.md",
]);

const ORPHAN_DIRECTORY_HINTS = new Set(["random", "untitled", "tmp", "temp", "draft", "drafts", "misc", "杂项", "临时"]);

export class DeterministicReviewerModel implements ReviewerModel {
  async generateKnowledgeMap(input: KnowledgeMapInput): Promise<KnowledgeMap> {
    const { context, options } = input;
    const topicMap = new Map<string, KnowledgeTopic>();

    for (const file of context.files.filter((candidate) => candidate.mediaType === "markdown")) {
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
      existing.keyConcepts = collectUnique([...existing.keyConcepts, ...file.headingTitles]).slice(0, 8);
      topicMap.set(topicTitle, existing);
    }

    const topics = [...topicMap.values()]
      .map((topic) => ({
        ...topic,
        relatedFiles: topic.relatedFiles.slice(0, options.maxFilesPerTopic),
        keyConcepts: collectKeyConcepts(topic),
        summary: buildTopicSummary(topic),
      }))
      .sort((a, b) => b.relatedFiles.length - a.relatedFiles.length)
      .slice(0, options.maxTopics);

    return {
      id: createId("map"),
      vaultPath: context.vaultPath,
      scopePath: context.scopePath,
      generatedAt: nowIso(),
      basedOnScanId: context.scanId,
      topics,
      summary: `Generated ${topics.length} topic candidate(s) from ${context.stats.markdownFiles} markdown file(s).`,
    };
  }

  async generateMaintenanceReview(input: MaintenanceReviewInput): Promise<MaintenanceReview> {
    const { context, options } = input;
    const findings: MaintenanceFinding[] = [];
    const markdownFiles = context.files.filter((candidate) => candidate.mediaType === "markdown");

    for (const file of markdownFiles) {
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

      if (isLikelyStale(file.path)) {
        findings.push({
          id: createId("finding"),
          type: "stale_note",
          severity: "medium",
          filePaths: [file.path],
          observation: "The file path or name suggests this note may represent old, legacy, draft, archived, or deprecated material.",
          whyItMatters: "Older notes can still contain durable decisions, but they can also mislead future work if their status is unclear.",
          suggestion: "Manually check whether durable insights should be extracted into current notes, and mark the old note status clearly if needed.",
          relatedFiles: [],
          confidence: 0.5,
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

      if (isLikelyOrphan(file)) {
        findings.push({
          id: createId("finding"),
          type: "orphan_note",
          severity: "low",
          filePaths: [file.path],
          observation: "This note appears to live in a temporary, miscellaneous, shallow, or weakly categorized location.",
          whyItMatters: "Orphan notes are easy to lose because future review has no stable topic entry point for finding them again.",
          suggestion: "Decide whether this note belongs under a stable project, concept, course, or archive topic.",
          relatedFiles: [],
          confidence: 0.45,
        });
      }

      if (isSuperficial(file)) {
        findings.push({
          id: createId("finding"),
          type: "superficial_note",
          severity: "low",
          filePaths: [file.path],
          observation: "This note is very short and may not contain enough durable content to warrant a standalone file.",
          whyItMatters: "Very short notes are harder to re-discover and may be better folded into a parent topic or deleted if stale.",
          suggestion: "Check whether this note's content can be merged into a larger topic note or whether it is still relevant.",
          relatedFiles: [],
          confidence: 0.55,
        });
      }
    }

    findings.push(...buildMissingIndexFindings(markdownFiles));
    findings.push(...buildDuplicateTopicFindings(markdownFiles));

    return {
      id: createId("review"),
      vaultPath: context.vaultPath,
      scopePath: context.scopePath,
      generatedAt: nowIso(),
      basedOnScanId: context.scanId,
      findings,
      summary: `Found ${findings.length} maintenance finding(s) from ${context.stats.markdownFiles} markdown file(s).`,
    };
  }
}

function inferTopicTitle(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  if (parts[0] === "projects" && parts.length >= 2) return parts.slice(0, 2).join("/");
  if (parts[0] === "notes" && parts.length >= 3) return parts.slice(0, 3).join("/");
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
  if (isIndexFile(filePath)) return "index";
  if (lower.includes("vision") || lower.includes("prd") || lower.includes("overview")) return "overview";
  if (lower.includes("decision") || lower.includes("adr")) return "decision";
  if (lower.includes("draft") || lower.includes("temp")) return "draft";
  if (isLikelyStale(filePath)) return "outdated";
  return "unknown";
}

function buildFileSummary(file: ReviewerFileContext): string {
  const details = [
    file.lineCount === undefined ? undefined : `${file.lineCount} lines`,
    file.wordCount === undefined ? undefined : `${file.wordCount} words/chars`,
    `layer: ${file.layer}`,
    file.headingTitles.length > 0 ? `Headings: ${file.headingTitles.slice(0, 3).join(", ")}` : undefined,
    file.excerpt ? `Excerpt: ${file.excerpt}` : undefined,
  ].filter(Boolean);
  return details.join("; ");
}

function collectKeyConcepts(topic: KnowledgeTopic): string[] {
  return collectUnique(topic.keyConcepts).slice(0, 8);
}

function buildTopicSummary(topic: KnowledgeTopic): string {
  const keyConcepts = collectKeyConcepts(topic).slice(0, 3);
  const base = `${topic.title} contains ${topic.relatedFiles.length} markdown file(s).`;
  if (keyConcepts.length === 0) return base;
  return `${base} Common headings: ${keyConcepts.join(", ")}.`;
}

function isLikelyAiOutput(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.includes("output") || lower.includes("ai-generated") || lower.includes("chatgpt") || lower.includes("claude");
}

function collectUnique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isLikelyStale(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return ["old", "legacy", "deprecated", "archive", "archived", "草稿", "旧版", "过时", "废弃"].some((hint) =>
    lower.includes(hint),
  );
}

function isLikelyOrphan(file: ReviewerFileContext): boolean {
  const parts = file.path.split("/").filter(Boolean);
  if (parts.length <= 1) return true;
  if (ORPHAN_DIRECTORY_HINTS.has(parts[0]?.toLowerCase() ?? "")) return true;
  if (parts.some((part) => ORPHAN_DIRECTORY_HINTS.has(part.toLowerCase()))) return true;
  return false;
}

function isSuperficial(file: ReviewerFileContext): boolean {
  const lineCount = file.lineCount ?? 0;
  const wordCount = file.wordCount ?? 0;
  return lineCount < 10 && wordCount < 200;
}

function buildMissingIndexFindings(files: ReviewerFileContext[]): MaintenanceFinding[] {
  return [...groupFilesByDirectory(files).entries()]
    .filter(([, directoryFiles]) => directoryFiles.length >= 3)
    .filter(([, directoryFiles]) => !directoryFiles.some((file) => isIndexFile(file.path)))
    .map(([directory, directoryFiles]) => ({
      id: createId("finding"),
      type: "missing_index" as const,
      severity: "medium" as const,
      filePaths: directoryFiles.map((file) => file.path),
      observation: `The directory ${directory} contains ${directoryFiles.length} Markdown files but no obvious index or overview note.`,
      whyItMatters: "A topic with several notes but no entry point increases context recovery cost when revisiting the area later.",
      suggestion: "Consider creating a README, index, overview, 概览, or 总览 note that summarizes the topic and links the key files.",
      relatedFiles: [],
      confidence: 0.65,
    }));
}

function groupFilesByDirectory(files: ReviewerFileContext[]): Map<string, ReviewerFileContext[]> {
  const groups = new Map<string, ReviewerFileContext[]>();
  for (const file of files) {
    const directory = path.posix.dirname(file.path);
    if (directory === ".") continue;
    const current = groups.get(directory) ?? [];
    current.push(file);
    groups.set(directory, current);
  }
  return groups;
}

function buildDuplicateTopicFindings(files: ReviewerFileContext[]): MaintenanceFinding[] {
  const findings: MaintenanceFinding[] = [];
  for (const [, directoryFiles] of groupFilesByDirectory(files)) {
    if (directoryFiles.length < 2) continue;
    for (let i = 0; i < directoryFiles.length; i++) {
      for (let j = i + 1; j < directoryFiles.length; j++) {
        const overlap = headingOverlap(directoryFiles[i], directoryFiles[j]);
        if (overlap >= 0.3) {
          findings.push({
            id: createId("finding"),
            type: "duplicate_topic",
            severity: "medium",
            filePaths: [directoryFiles[i].path, directoryFiles[j].path],
            observation: `These two files share significant heading overlap (${Math.round(overlap * 100)}%).`,
            whyItMatters: "Files covering very similar ground may split durable insights across multiple locations, making them harder to maintain and recall.",
            suggestion: "Consider whether these files should be merged, or whether one should delegate to the other with a short cross-reference.",
            relatedFiles: [],
            confidence: 0.4 + overlap * 0.4,
          });
        }
      }
    }
  }
  return findings;
}

function headingOverlap(a: ReviewerFileContext, b: ReviewerFileContext): number {
  if (a.headingTitles.length === 0 || b.headingTitles.length === 0) return 0;
  const setA = new Set(a.headingTitles.map((title) => title.toLowerCase()));
  const setB = new Set(b.headingTitles.map((title) => title.toLowerCase()));
  let intersection = 0;
  let union = new Set([...setA, ...setB]).size;
  for (const title of setA) {
    if (setB.has(title)) intersection++;
  }
  return union === 0 ? 0 : intersection / union;
}

function isIndexFile(filePath: string): boolean {
  return INDEX_FILE_NAMES.has(path.posix.basename(filePath).toLowerCase());
}
