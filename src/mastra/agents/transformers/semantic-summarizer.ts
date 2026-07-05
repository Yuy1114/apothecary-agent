import { Agent } from "@mastra/core/agent";

// Minimal, tool-less agent used only to produce structured file summaries.
// Deliberately has no tools, input processors, memory, or scorers so batch
// summarization over the whole vault stays cheap and side-effect free.
export const semanticSummarizer = new Agent({
  id: "semantic-summarizer",
  name: "Semantic Summarizer",
  description: "Produces a structured semantic summary for a single vault file.",
  instructions:
    "You summarize a single Markdown note for a knowledge base's semantic layer (agent-internal understanding). " +
    "Return a concise one-line gist, the high-level topics it belongs to, the key concepts it covers, " +
    "and a short paragraph summary. Be specific and faithful to the content; do not invent facts. " +
    "Always write gist, topics, concepts, and summary in ENGLISH, even when the source content is in Chinese, " +
    "so the semantic layer stays a single consistent language. Keep proper nouns, names, and identifiers as they appear.",
  model: "deepseek/deepseek-v4-flash",
});
