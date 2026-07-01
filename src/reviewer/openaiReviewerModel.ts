import OpenAI from "openai";
import { KnowledgeMapSchema, type KnowledgeMap } from "../domain/knowledgeMap.js";
import { MaintenanceReviewSchema, type MaintenanceReview } from "../domain/maintenanceReview.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";
import type { ReviewerModel, KnowledgeMapInput, MaintenanceReviewInput } from "./reviewerModel.js";

type OpenAIOptions = {
  model: string;
  apiKey?: string;
  baseURL?: string;
};

export class OpenAIReviewerModel implements ReviewerModel {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAIOptions) {
    this.model = options.model;
    this.client = new OpenAI({
      apiKey: options.apiKey ?? process.env.APOTHECARY_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
      baseURL: options.baseURL ?? process.env.APOTHECARY_OPENAI_BASE_URL,
    });
  }

  async generateKnowledgeMap(input: KnowledgeMapInput): Promise<KnowledgeMap> {
    const { context, options } = input;

    const completion = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: KNOWLEDGE_MAP_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            vaultPath: context.vaultPath,
            scopePath: context.scopePath,
            stats: context.stats,
            files: context.files.map((file) => ({
              path: file.path,
              title: file.title,
              headingTitles: file.headingTitles,
              excerpt: file.excerpt,
              layer: file.layer,
              lineCount: file.lineCount,
              wordCount: file.wordCount,
            })),
            maxTopics: options.maxTopics,
            maxFilesPerTopic: options.maxFilesPerTopic,
          }),
        },
      ],
    });

    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    const hydrated = {
      ...raw,
      id: createId("map"),
      vaultPath: context.vaultPath,
      scopePath: context.scopePath,
      generatedAt: nowIso(),
      basedOnScanId: context.scanId,
      topics: (raw.topics ?? []).map((topic: Record<string, unknown>) => ({
        ...topic,
        id: createId("topic"),
        relatedFiles: ((topic.relatedFiles as Record<string, unknown>[]) ?? []).map((file) => ({
          ...file,
          id: createId("file"),
        })),
      })),
    };
    return KnowledgeMapSchema.parse(hydrated);
  }

  async generateMaintenanceReview(input: MaintenanceReviewInput): Promise<MaintenanceReview> {
    const { context, options } = input;

    const completion = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: MAINTENANCE_REVIEW_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            vaultPath: context.vaultPath,
            scopePath: context.scopePath,
            stats: context.stats,
            files: context.files.map((file) => ({
              path: file.path,
              title: file.title,
              headingTitles: file.headingTitles,
              excerpt: file.excerpt,
              layer: file.layer,
              lineCount: file.lineCount,
              wordCount: file.wordCount,
            })),
            longContextWordThreshold: options.longContextWordThreshold,
            longContextLineThreshold: options.longContextLineThreshold,
          }),
        },
      ],
    });

    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    const hydrated = {
      ...raw,
      id: createId("review"),
      vaultPath: context.vaultPath,
      scopePath: context.scopePath,
      generatedAt: nowIso(),
      basedOnScanId: context.scanId,
      findings: (raw.findings ?? []).map((finding: Record<string, unknown>) => ({
        ...finding,
        id: createId("finding"),
        relatedFiles: finding.relatedFiles ?? [],
      })),
    };
    return MaintenanceReviewSchema.parse(hydrated);
  }
}

const KNOWLEDGE_MAP_SYSTEM_PROMPT = `You are apothecary-agent, a read-only vault reviewer for a local Markdown knowledge base.

Your task: Given a list of Markdown files with their headings and excerpts, produce a **knowledge map** — a structured overview of topics and their files.

Return a JSON object with this schema:

{
  "topics": [
    {
      "title": "topic name (e.g. project or concept area)",
      "category": "project | course | reflection | unknown",
      "summary": "1-2 sentence summary of what this topic covers",
      "keyConcepts": ["key concept 1", "key concept 2"],
      "relatedFiles": [
        {
          "path": "relative/file/path.md",
          "title": "Human-readable file title",
          "summary": "1 sentence about this file's purpose",
          "role": "overview | decision | draft | outdated | index | unknown",
          "relevance": 0.0-1.0
        }
      ],
      "openQuestions": ["question the topic leaves open"],
      "confidence": 0.0-1.0
    }
  ],
  "summary": "1-2 sentence overview of the whole map"
}

Rules:
- Group files into topics by their path prefix and content overlap.
- keyConcepts should be the 3-8 most important recurring ideas from headings.
- Be concise. Summaries should be 1-2 sentences.
- Only include topics that have at least one Markdown file.
- Confidence reflects how certain you are about a topic grouping.`;

const MAINTENANCE_REVIEW_SYSTEM_PROMPT = `You are apothecary-agent, a read-only vault reviewer for a local Markdown knowledge base.

Your task: Given a list of Markdown files with their headings and excerpts, produce a **maintenance review** — findings about stale, duplicate, orphaned, or poorly maintained knowledge.

Return a JSON object with this schema:

{
  "findings": [
    {
      "type": "stale_note | long_context | orphan_note | duplicate_topic | unassimilated_ai_output | missing_index | unclear_location | superficial_note",
      "severity": "low | medium | high",
      "filePaths": ["relative/path/to/file.md"],
      "observation": "What you observed (specific, grounded in the file data)",
      "whyItMatters": "Why this finding matters for knowledge maintenance",
      "suggestion": "Concrete, actionable suggestion",
      "confidence": 0.0-1.0
    }
  ],
  "summary": "1-2 sentence summary of all findings"
}

Finding types:
- stale_note: File path or headings suggest old/legacy/deprecated material.
- long_context: File exceeds word or line thresholds and is expensive to re-read.
- orphan_note: File is in a temporary, miscellaneous, or shallow directory.
- duplicate_topic: Two files share highly overlapping headings and likely cover the same ground.
- unassimilated_ai_output: File path suggests AI-generated content that hasn't been absorbed.
- missing_index: A directory with 3+ Markdown files lacks an index/overview/README.
- unclear_location: File name or path is hard to categorize.
- superficial_note: File is very short and may lack durable content.

Rules:
- Each finding must reference specific filePaths (not speculative).
- confidence should reflect how certain you are (0.5 = heuristic, 0.8+ = clear evidence).
- Severity: high = urgent structural issue, medium = worthwhile improvement, low = minor.
- Be grounded in the actual file data provided — do not invent observations.`;
