import { knowledgeViewWriter } from "../agents/transformers/knowledge-view-writer.js";
import { KnowledgeViewDraftSchema } from "../../domain/knowledgeView.js";
import type { KnowledgeViewWriter, ViewEvidence } from "../../application/ports/knowledgeViewWriter.js";

function evidenceLine(e: ViewEvidence): string {
  return `- ${e.path}: ${e.gist} [topics: ${e.topics.join(", ")}; concepts: ${e.concepts.join(", ")}]`;
}

export const mastraKnowledgeViewWriter: KnowledgeViewWriter = {
  async write({ topic, evidence }) {
    const prompt = [
      `Topic: ${topic}`,
      "",
      "Per-file summaries (evidence):",
      evidence.length
        ? evidence.map(evidenceLine).join("\n")
        : "(no matching files found in the semantic layer)",
      "",
      "Build the knowledge-system view for this topic from the evidence above. Output ONLY the structured fields.",
    ].join("\n");

    const result = await knowledgeViewWriter.generate(prompt, {
      maxSteps: 1,
      toolChoice: "none",
      structuredOutput: { schema: KnowledgeViewDraftSchema, jsonPromptInjection: "system" },
    });

    const draft = result.object;
    if (!draft) {
      throw new Error(`View writer returned no structured output (finishReason=${result.finishReason}).`);
    }
    return draft;
  },
};
