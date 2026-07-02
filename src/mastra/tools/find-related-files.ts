import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { loadGraph } from "../../vault/semanticStore.js";
import { semanticNeighbors } from "../../domain/semanticGraph.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export const findRelatedFilesTool = createTool({
  id: "findRelatedFiles",
  description:
    "Find files semantically related to a given file — those sharing topics or concepts in the semantic graph. " +
    "Returns each related file with the shared topics/concepts and a relatedness score (higher = more shared). " +
    "Useful for exploring the knowledge network and for spotting related or potentially duplicate notes.",
  inputSchema: z.object({
    filePath: z.string().describe("Relative vault path of the file to find neighbors for"),
    limit: z.number().optional().describe("Max related files to return (default 10)"),
  }),
  outputSchema: z.object({
    filePath: z.string(),
    related: z.array(
      z.object({
        path: z.string(),
        sharedTopics: z.array(z.string()),
        sharedConcepts: z.array(z.string()),
        score: z.number(),
      }),
    ),
  }),
  execute: async ({ filePath, limit }) => {
    const graph = await loadGraph(VAULT_PATH);
    return { filePath, related: semanticNeighbors(graph, filePath, limit ?? 10) };
  },
});
