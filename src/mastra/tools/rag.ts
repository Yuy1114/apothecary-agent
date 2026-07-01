import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { embed } from "ai";
import { ModelRouterEmbeddingModel } from "@mastra/core/llm";
import type { LibSQLVector } from "@mastra/libsql";

export const EMBEDDING_MODEL = new ModelRouterEmbeddingModel({
  providerId: "aihubmix",
  modelId: "text-embedding-3-small",
  url: process.env.APOTHECARY_EMBEDDING_BASE_URL ?? "https://api.aihubmix.com/v1",
  apiKey:
    process.env.APOTHECARY_EMBEDDING_API_KEY ??
    process.env.OPENAI_API_KEY ??
    "",
});

const INDEX_NAME = "vault_chunks";

function getVector(
  context: { mastra?: { getVector?: (name: string) => unknown } } | undefined
): LibSQLVector {
  const vs = (context as any)?.mastra?.getVector?.("vaultChunks");
  if (!vs)
    throw new Error("Vector store 'vaultChunks' not found in Mastra instance");
  return vs as LibSQLVector;
}

export const queryVaultTool = createTool({
  id: "queryVault",
  description:
    "Search the vault for relevant content using semantic search. Returns matching chunks with source file, heading breadcrumb, and content snippet.",
  inputSchema: z.object({
    query: z.string().describe("The search query."),
    topK: z
      .number()
      .optional()
      .default(5)
      .describe("Number of results to return."),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        source: z.string(),
        title: z.string().optional(),
        headings: z.array(z.string()).optional(),
        content: z.string(),
        score: z.number(),
      })
    ),
  }),
  execute: async ({ query, topK }, context) => {
    const { embedding } = await embed({ model: EMBEDDING_MODEL, value: query });
    const vs = getVector(context);

    const results = await vs.query({
      indexName: INDEX_NAME,
      queryVector: embedding as unknown as number[],
      topK,
    });

    return {
      results: results.map((r) => ({
        source: (r.metadata?.source as string) ?? "",
        title: (r.metadata?.title as string) || undefined,
        headings: parseHeadings(r.metadata?.headingsJson),
        content: (r.metadata?.content as string)?.slice(0, 1000) ?? "",
        score: r.score,
      })),
    };
  },
});

function parseHeadings(rawValue: unknown): string[] | undefined {
  if (typeof rawValue !== "string") return undefined;
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}
