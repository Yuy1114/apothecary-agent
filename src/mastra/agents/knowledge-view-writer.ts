import { Agent } from "@mastra/core/agent";

// Minimal, tool-less agent that synthesizes a human-facing knowledge system
// view (in Chinese) from file summaries. No tools/processors/memory.
export const knowledgeViewWriter = new Agent({
  id: "knowledge-view-writer",
  name: "Knowledge View Writer",
  description: "Synthesizes a structured knowledge-system view for a topic from file summaries.",
  instructions:
    "You build a human-facing knowledge-system view for a topic, using the provided per-file summaries as evidence. " +
    "Produce: an overview of the topic area, the core sub-topics, the key concepts, the current gaps or weak spots, " +
    "and a recommended reading order (use the given file paths/titles). Be faithful to the summaries; do not invent files or facts. " +
    "This view is for the user to read, so write it in Chinese.",
  model: "deepseek/deepseek-v4-flash",
});
