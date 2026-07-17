import { z } from "zod";
import { digestWriter } from "../agents/transformers/digest-writer.js";
import type { DigestWriter } from "../../application/ports/digestWriter.js";

const DigestSummarySchema = z.object({
  /** The 2-4 sentence Chinese narrative for the digest's `## 摘要` section. */
  summary: z.string().min(1),
});

export const mastraDigestWriter: DigestWriter = {
  async summarize({ periodTitle, factsMarkdown }) {
    const prompt = [
      `Period: ${periodTitle}`,
      "",
      "Activity facts (the complete record — use nothing else):",
      factsMarkdown,
      "",
      "Write the summary narrative. Output ONLY the structured fields.",
    ].join("\n");

    const result = await digestWriter.generate(prompt, {
      maxSteps: 1,
      toolChoice: "none",
      structuredOutput: { schema: DigestSummarySchema, jsonPromptInjection: "system" },
    });
    if (!result.object) {
      throw new Error(`Digest writer returned no structured output (finishReason=${result.finishReason}).`);
    }
    return result.object.summary;
  },
};
