import { duplicateClassifier } from "../agents/transformers/duplicate-classifier.js";
import { ClassificationDraftSchema, type ClassificationDraft } from "../../domain/duplicateDetection.js";
import type { FileSummaries } from "../../domain/semantic.js";

function fileBlock(path: string, summaries: FileSummaries): string {
  const s = summaries[path];
  if (!s) return `${path}: (no summary)`;
  return [
    `Path: ${path}`,
    `Title: ${s.title}`,
    `Gist: ${s.gist}`,
    `Concepts: ${s.concepts.join(", ")}`,
    `Summary: ${s.summary}`,
  ].join("\n");
}

export async function classifyDuplicate(input: {
  files: [string, string];
  sharedConcepts: string[];
  summaries: FileSummaries;
}): Promise<ClassificationDraft> {
  const prompt = [
    `Shared concepts: ${input.sharedConcepts.join(", ")}`,
    "",
    "Note A:",
    fileBlock(input.files[0], input.summaries),
    "",
    "Note B:",
    fileBlock(input.files[1], input.summaries),
    "",
    "Classify the relationship between these two notes. Output ONLY the structured fields.",
  ].join("\n");

  const result = await duplicateClassifier.generate(prompt, {
    maxSteps: 1,
    toolChoice: "none",
    structuredOutput: { schema: ClassificationDraftSchema, jsonPromptInjection: "system" },
  });

  const draft = result.object;
  if (!draft) {
    throw new Error(
      `Duplicate classifier returned no structured output for ${input.files.join(" / ")} (finishReason=${result.finishReason}).`,
    );
  }
  return draft;
}
