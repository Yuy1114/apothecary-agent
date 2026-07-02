import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { requiresHumanApproval } from "./permissions.js";
import { writeVaultNote } from "./ingest-core.js";

export const captureInsightTool = createTool({
  id: "captureInsight",
  description:
    "Capture a durable insight that surfaced in the conversation into the vault as a lasting note " +
    "(a decision, principle, learning conclusion, or job-evidence point worth keeping long-term). " +
    "Synthesize the insight into clean standalone content first. Classifies it, writes it to the right directory, " +
    "indexes it, and audits it. This creates a user note, so it requires human approval; explain the proposed " +
    "location and why before it is written.",
  requireApproval: requiresHumanApproval,
  inputSchema: z.object({
    content: z.string().describe("The insight, synthesized into clean standalone note content."),
    title: z.string().optional().describe("Short title for the insight."),
    topic: z.string().optional().describe("Directory hint, e.g. 'reflections/' or 'notes/programming/Redis'"),
  }),
  outputSchema: z.object({
    filePath: z.string(),
    topic: z.string(),
    title: z.string(),
  }),
  execute: async ({ content, title, topic }) => {
    const result = await writeVaultNote({
      content,
      title,
      topic,
      noteType: "insight",
      source: "conversation",
      operationType: "capture",
    });
    return { filePath: result.filePath, topic: result.topic, title: result.title };
  },
});
