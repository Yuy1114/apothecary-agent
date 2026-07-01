import { createOpenAI } from "@ai-sdk/openai";
import type { EmbeddingModel } from "ai";

let model: EmbeddingModel | null = null;

export function getEmbeddingModel(): EmbeddingModel {
  model ??= createOpenAI({
    apiKey: process.env.APOTHECARY_EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    baseURL: process.env.APOTHECARY_EMBEDDING_BASE_URL ?? "https://api.aihubmix.com/v1",
  }).embedding(process.env.APOTHECARY_EMBEDDING_MODEL ?? "text-embedding-3-small");

  return model;
}
