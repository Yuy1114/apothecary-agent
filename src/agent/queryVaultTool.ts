import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { queryVault } from "../rag/chromaStore.js";

export const queryVaultTool = createTool({
  id: "queryVault",
  description: "Search the vault knowledge base for relevant content. Use this to answer questions about what the user has learned, written, or stored in their notes.",
  inputSchema: z.object({
    query: z.string().describe("The search query. Be specific about what you want to find."),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      source: z.string(),
      content: z.string(),
    })),
  }),
  execute: async ({ query }) => {
    const results = await queryVault(query, 5);
    return { results };
  },
});
