import { profileWriter } from "../../mastra/agents/transformers/profile-writer.js";
import {
  ProfileNarrativeSchema,
  buildProfileStats,
  type KnowledgeProfile,
} from "../../domain/knowledgeProfile.js";
import type { FileSummaries, SemanticGraph } from "../../domain/semantic.js";
import type { DuplicateReport } from "../../domain/duplicateDetection.js";

const MAX_GISTS = 80;

export async function generateKnowledgeProfile(input: {
  summaries: FileSummaries;
  graph: SemanticGraph;
  dupReport: DuplicateReport;
}): Promise<KnowledgeProfile> {
  const stats = buildProfileStats(input.summaries, input.graph, input.dupReport);

  const gists = Object.values(input.summaries)
    .slice(0, MAX_GISTS)
    .map((s) => `- ${s.path}: ${s.gist}`)
    .join("\n");

  const prompt = [
    "Vault statistics:",
    `- files: ${stats.fileCount}, topics: ${stats.topicCount}, concepts: ${stats.conceptCount}`,
    `- by directory: ${stats.byDirectory.map((d) => `${d.dir}(${d.fileCount})`).join(", ")}`,
    `- top topics: ${stats.topTopics.map((t) => `${t.label}(${t.fileCount})`).join(", ")}`,
    `- top concepts: ${stats.topConcepts.map((c) => `${c.label}(${c.fileCount})`).join(", ")}`,
    `- duplicates: harmful ${stats.duplicates.harmful}, contextual ${stats.duplicates.contextual}, evolutionary ${stats.duplicates.evolutionary}`,
    "",
    "File gists (sample):",
    gists,
    "",
    "Produce the knowledge profile narrative. Output ONLY the structured fields.",
  ].join("\n");

  const result = await profileWriter.generate(prompt, {
    maxSteps: 1,
    toolChoice: "none",
    structuredOutput: { schema: ProfileNarrativeSchema, jsonPromptInjection: "system" },
  });

  const narrative = result.object;
  if (!narrative) {
    throw new Error(`Profile writer returned no structured output (finishReason=${result.finishReason}).`);
  }

  return { generatedAt: new Date().toISOString(), stats, ...narrative };
}
