import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { loadGraph } from "../../vault/semanticStore.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export const listSemanticTopicsTool = createTool({
  id: "listSemanticTopics",
  description:
    "Get a birds-eye view of the vault's knowledge network: the topics and concepts across all files, " +
    "each with how many files cover it (most-covered first). Built from the semantic layer. " +
    "Use this to understand what the vault is about at a high level. Empty until the refresh-semantics workflow has run.",
  inputSchema: z.object({
    limit: z.number().optional().describe("Max topics and concepts to return (default 20)"),
    minFiles: z
      .number()
      .optional()
      .describe("Only include labels covering at least this many files (default 2, so single-file noise is hidden; set 1 to include everything)"),
  }),
  outputSchema: z.object({
    topics: z.array(z.object({ label: z.string(), fileCount: z.number() })),
    concepts: z.array(z.object({ label: z.string(), fileCount: z.number() })),
  }),
  execute: async ({ limit, minFiles }) => {
    const graph = await loadGraph(VAULT_PATH);
    const take = limit ?? 20;
    const floor = minFiles ?? 2;
    const shape = (entries: typeof graph.topics) =>
      entries
        .filter((e) => e.files.length >= floor)
        .slice(0, take)
        .map((e) => ({ label: e.label, fileCount: e.files.length }));
    return { topics: shape(graph.topics), concepts: shape(graph.concepts) };
  },
});
