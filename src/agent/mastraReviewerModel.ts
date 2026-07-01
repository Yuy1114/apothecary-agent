import { Agent } from "@mastra/core/agent";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { MaintenanceReviewSchema, type MaintenanceReview } from "../domain/maintenanceReview.js";
import { KnowledgeMapSchema, type KnowledgeMap } from "../domain/knowledgeMap.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";
import type { ReviewerModel, KnowledgeMapInput, MaintenanceReviewInput } from "../reviewer/reviewerModel.js";
import { scanVaultTool, readMarkdownTool, writeReviewTool } from "./tools.js";
import { queryVaultTool } from "./queryVaultTool.js";
import { proposeEditTool } from "./proposeEditTool.js";

export class MastraReviewerModel implements ReviewerModel {
  private readonly agent: Agent;

  constructor(options: { model: string; apiKey?: string; baseURL?: string }) {
    const deepseek = createOpenAICompatible({
      name: "deepseek",
      baseURL: (options.baseURL ?? process.env.APOTHECARY_OPENAI_BASE_URL ?? "https://api.deepseek.com") + "/v1",
      apiKey: options.apiKey ?? process.env.APOTHECARY_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    });

    this.agent = new Agent({
      id: "vault-reviewer",
      name: "Vault Reviewer",
      description: "Read-only vault reviewer that produces knowledge maps and maintenance reviews.",
      instructions:
        "You are apothecary-agent, a read-only vault reviewer for a local Markdown knowledge base. " +
        "Your job is to review the vault and produce structured maintenance findings. " +
        "Use scanVault to explore the vault and readMarkdown to inspect interesting files in detail. " +
        "When done, call writeReview to persist your findings.",
      model: deepseek(options.model),
      tools: {
        scanVault: scanVaultTool,
        readMarkdown: readMarkdownTool,
        writeReview: writeReviewTool,
        queryVault: queryVaultTool,
        proposeEdit: proposeEditTool,
      },
    });
  }

  async generateKnowledgeMap(input: KnowledgeMapInput): Promise<KnowledgeMap> {
    const { context, options } = input;

    const result = await this.agent.generate(
      `Review the vault and produce a knowledge map in JSON format. ` +
        `Group files into topics by path and content similarity. ` +
        `Max topics: ${options.maxTopics}. Max files per topic: ${options.maxFilesPerTopic}.\n\n` +
        `Context (${context.files.length} files):\n` +
        JSON.stringify({
          vaultPath: context.vaultPath,
          scopePath: context.scopePath,
          stats: context.stats,
          files: context.files.map((f) => ({
            path: f.path,
            title: f.title,
            headingTitles: f.headingTitles,
            excerpt: f.excerpt,
            layer: f.layer,
          })),
        }),
      {
        maxSteps: 3,
        toolChoice: "auto" as const,
      },
    );

    const json = extractJson(result.text);
    try {
      const raw = JSON.parse(json);
      return KnowledgeMapSchema.parse(hydrateKnowledgeMap(raw, context));
    } catch {
      return emptyKnowledgeMap(context);
    }
  }

  async generateMaintenanceReview(input: MaintenanceReviewInput): Promise<MaintenanceReview> {
    const { context, options } = input;

    const result = await this.agent.generate(
      `Review the vault and produce maintenance findings. ` +
        `Use scanVault to explore and readMarkdown to inspect files in detail. ` +
        `When your analysis is complete, call writeReview to persist your findings.\n\n` +
        `Thresholds: long_context = >${options.longContextWordThreshold} words OR >${options.longContextLineThreshold} lines.\n` +
        `Finding types: stale_note, long_context, orphan_note, duplicate_topic, unassimilated_ai_output, missing_index, unclear_location, superficial_note.\n` +
        `Severity: low, medium, high.\n\n` +
        `Context (${context.files.length} files):\n` +
        JSON.stringify({
          vaultPath: context.vaultPath,
          scopePath: context.scopePath,
          stats: context.stats,
          files: context.files.map((f) => ({
            path: f.path,
            title: f.title,
            headingTitles: f.headingTitles,
            excerpt: f.excerpt,
            layer: f.layer,
            lineCount: f.lineCount,
            wordCount: f.wordCount,
          })),
        }),
      {
        maxSteps: 5,
        toolChoice: "auto" as const,
      },
    );

    // Extract findings from writeReview tool calls
    const writeResults = result.toolResults?.filter((tr) => tr.payload?.toolName === "writeReview") ?? [];
    const toolFindings = writeResults.flatMap(
      (tr) => (tr.payload?.result as { findings?: unknown[] })?.findings ?? [],
    );
    const toolSummary =
      (writeResults[0]?.payload?.result as { summary?: string })?.summary ??
      `Found ${toolFindings.length} maintenance finding(s).`;

    if (toolFindings.length > 0) {
      return MaintenanceReviewSchema.parse({
        id: createId("review"),
        vaultPath: context.vaultPath,
        scopePath: context.scopePath,
        generatedAt: nowIso(),
        basedOnScanId: context.scanId,
        findings: toolFindings.map((f) => ({
          ...(f as Record<string, unknown>),
          id: createId("finding"),
          relatedFiles: (f as Record<string, unknown>).relatedFiles ?? [],
        })),
        summary: toolSummary,
      });
    }

    // Fallback: parse JSON from text
    const json = extractJson(result.text);
    try {
      const raw = JSON.parse(json);
      return MaintenanceReviewSchema.parse(hydrateMaintenanceReview(raw, context));
    } catch {
      return emptyMaintenanceReview(context);
    }
  }
}

function extractJson(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : "{}";
}

function hydrateKnowledgeMap(raw: Record<string, unknown>, context: KnowledgeMapInput["context"]) {
  return {
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
  };
}

function hydrateMaintenanceReview(raw: Record<string, unknown>, context: MaintenanceReviewInput["context"]) {
  return {
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
  };
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
