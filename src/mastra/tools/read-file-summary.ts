import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { loadSummaries } from "../../vault/semanticStore.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";

export const readFileSummaryTool = createTool({
  id: "readFileSummary",
  description:
    "Read the agent's stored semantic summary for a vault file (gist, topics, concepts, summary) from the semantic layer. " +
    "Use this to understand what a file is about without reading the whole file. Returns found=false if it has not been generated yet " +
    "(run the refresh-semantics workflow to build the semantic layer).",
  inputSchema: z.object({
    filePath: z.string().describe("Relative path inside the vault, e.g. 'notes/programming/Redis/README.md'"),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    filePath: z.string(),
    gist: z.string().optional(),
    topics: z.array(z.string()).optional(),
    concepts: z.array(z.string()).optional(),
    summary: z.string().optional(),
    generatedAt: z.string().optional(),
  }),
  execute: async ({ filePath }) => {
    const summaries = await loadSummaries(apothecaryHome());
    const entry = summaries[filePath];
    if (!entry) return { found: false, filePath };
    return {
      found: true,
      filePath,
      gist: entry.gist,
      topics: entry.topics,
      concepts: entry.concepts,
      summary: entry.summary,
      generatedAt: entry.generatedAt,
    };
  },
});
