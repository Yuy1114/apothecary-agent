import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { queryVault } from "../../rag/vectorStore.js";

export const queryVaultTool = createTool({
  id: "queryVault",
  description:
    "Search the vault for relevant content using semantic search. Returns matching chunks with their source file, heading breadcrumb, and content snippet. Use this to answer questions about what the user has learned or stored.",
  inputSchema: z.object({
    query: z.string().describe("The search query."),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        source: z.string(),
        title: z.string().optional(),
        headings: z.array(z.string()).optional(),
        content: z.string(),
      }),
    ),
  }),
  execute: async ({ query }) => {
    const results = await queryVault(query, 5);
    return { results };
  },
});
