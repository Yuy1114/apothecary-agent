import { semanticSummarizer } from "../../mastra/agents/semantic-summarizer.js";
import { FileSummaryDraftSchema, type FileSummary } from "../../domain/semantic.js";

const MAX_CONTENT_CHARS = 6000;

export async function generateFileSummary(input: {
  path: string;
  title: string;
  content: string;
  contentHash: string;
}): Promise<FileSummary> {
  const prompt = [
    `File: ${input.path}`,
    input.title ? `Title: ${input.title}` : "",
    "",
    "Content:",
    input.content.slice(0, MAX_CONTENT_CHARS),
    "",
    "Summarize this note. Output ONLY the structured fields.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await semanticSummarizer.generate(prompt, {
    maxSteps: 1,
    toolChoice: "none",
    structuredOutput: { schema: FileSummaryDraftSchema, jsonPromptInjection: "system" },
  });

  const draft = result.object;
  if (!draft) {
    throw new Error(
      `Summarizer returned no structured output for ${input.path} (finishReason=${result.finishReason}).`,
    );
  }

  return {
    path: input.path,
    contentHash: input.contentHash,
    generatedAt: new Date().toISOString(),
    title: input.title,
    gist: draft.gist,
    topics: draft.topics,
    concepts: draft.concepts,
    summary: draft.summary,
  };
}
