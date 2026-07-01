import OpenAI from "openai";
import { MaintenanceReviewSchema, type MaintenanceReview } from "../domain/maintenanceReview.js";
import { KnowledgeMapSchema, type KnowledgeMap } from "../domain/knowledgeMap.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";
import type { ReviewerModel, KnowledgeMapInput, MaintenanceReviewInput } from "../reviewer/reviewerModel.js";

type MastraOptions = {
  model: string;
  apiKey?: string;
  baseURL?: string;
};

export class MastraReviewerModel implements ReviewerModel {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: MastraOptions) {
    this.model = options.model;
    this.client = new OpenAI({
      apiKey: options.apiKey ?? process.env.APOTHECARY_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
      baseURL: options.baseURL ?? process.env.APOTHECARY_OPENAI_BASE_URL ?? "https://api.deepseek.com",
    });
  }

  async generateKnowledgeMap(input: KnowledgeMapInput): Promise<KnowledgeMap> {
    const { context, options } = input;

    const completion = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: KNOWLEDGE_MAP_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(mapContextPayload(context, options)) },
      ],
    });

    const text = completion.choices[0]?.message?.content ?? "{}";
    return parseKnowledgeMap(text, context);
  }

  async generateMaintenanceReview(input: MaintenanceReviewInput): Promise<MaintenanceReview> {
    const { context, options } = input;

    const completion = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: MAINTENANCE_REVIEW_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(reviewContextPayload(context, options)) },
      ],
    });

    const text = completion.choices[0]?.message?.content ?? "{}";
    return parseMaintenanceReview(text, context);
  }
}

function mapContextPayload(
  context: KnowledgeMapInput["context"],
  options: KnowledgeMapInput["options"],
) {
  return {
    vaultPath: context.vaultPath,
    scopePath: context.scopePath,
    stats: context.stats,
    files: context.files.map(stripFile),
    maxTopics: options.maxTopics,
    maxFilesPerTopic: options.maxFilesPerTopic,
  };
}

function reviewContextPayload(
  context: MaintenanceReviewInput["context"],
  options: MaintenanceReviewInput["options"],
) {
  return {
    vaultPath: context.vaultPath,
    scopePath: context.scopePath,
    stats: context.stats,
    files: context.files.map(stripFile),
    thresholds: {
      longContextWord: options.longContextWordThreshold,
      longContextLine: options.longContextLineThreshold,
    },
  };
}

function stripFile(file: { path: string; title?: string; headingTitles: string[]; excerpt?: string; layer: string; lineCount?: number; wordCount?: number }) {
  return {
    path: file.path,
    title: file.title,
    headingTitles: file.headingTitles,
    excerpt: file.excerpt,
    layer: file.layer,
    lineCount: file.lineCount,
    wordCount: file.wordCount,
  };
}

function parseKnowledgeMap(text: string, context: KnowledgeMapInput["context"]): KnowledgeMap {
  const json = extractJson(text);
  try {
    const raw = JSON.parse(json);
    return KnowledgeMapSchema.parse({
      ...raw,
      id: createId("map"),
      vaultPath: context.vaultPath,
      scopePath: context.scopePath,
      generatedAt: nowIso(),
      basedOnScanId: context.scanId,
      topics: ((raw.topics as Array<Record<string, unknown>>) ?? []).map((topic) => ({
        ...topic,
        id: createId("topic"),
        relatedFiles: ((topic.relatedFiles as Array<Record<string, unknown>>) ?? []).map((file) => ({
          ...file,
          id: createId("file"),
        })),
      })),
    });
  } catch {
    return emptyKnowledgeMap(context);
  }
}

function parseMaintenanceReview(text: string, context: MaintenanceReviewInput["context"]): MaintenanceReview {
  const json = extractJson(text);
  try {
    const raw = JSON.parse(json);
    return MaintenanceReviewSchema.parse({
      ...raw,
      id: createId("review"),
      vaultPath: context.vaultPath,
      scopePath: context.scopePath,
      generatedAt: nowIso(),
      basedOnScanId: context.scanId,
      findings: ((raw.findings as Array<Record<string, unknown>>) ?? []).map((finding) => ({
        ...finding,
        id: createId("finding"),
        relatedFiles: finding.relatedFiles ?? [],
      })),
    });
  } catch {
    return emptyMaintenanceReview(context);
  }
}

function extractJson(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : "{}";
}

function emptyKnowledgeMap(context: KnowledgeMapInput["context"]): KnowledgeMap {
  return {
    id: createId("map"),
    vaultPath: context.vaultPath,
    scopePath: context.scopePath,
    generatedAt: nowIso(),
    basedOnScanId: context.scanId,
    topics: [],
    summary: `Failed to parse. ${context.files.length} files scanned.`,
  };
}

function emptyMaintenanceReview(context: MaintenanceReviewInput["context"]): MaintenanceReview {
  return {
    id: createId("review"),
    vaultPath: context.vaultPath,
    scopePath: context.scopePath,
    generatedAt: nowIso(),
    basedOnScanId: context.scanId,
    findings: [],
    summary: `Failed to parse. ${context.files.length} files scanned.`,
  };
}

const KNOWLEDGE_MAP_SYSTEM_PROMPT = `You are apothecary-agent, a read-only vault reviewer.
Produce a knowledge map from the provided vault file list.
Group files into topics by path and content similarity.
Return valid JSON: {"topics": [{"title":"...","category":"project|course|reflection|unknown","summary":"...","keyConcepts":["..."],"relatedFiles":[{"path":"...","title":"...","summary":"...","role":"overview|decision|draft|outdated|index|unknown","relevance":0.8}],"openQuestions":[],"confidence":0.9}],"summary":"..."}`;

const MAINTENANCE_REVIEW_SYSTEM_PROMPT = `You are apothecary-agent, a read-only vault reviewer.
Review the vault file list and produce maintenance findings.
Finding types: stale_note, long_context, orphan_note, duplicate_topic, unassimilated_ai_output, missing_index, unclear_location, superficial_note.
Severity: low, medium, high.
Return valid JSON: {"findings":[{"type":"...","severity":"...","filePaths":["..."],"observation":"...","whyItMatters":"...","suggestion":"...","confidence":0.8}],"summary":"..."}`;
