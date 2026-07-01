import { Agent } from "@mastra/core/agent";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { queryVaultTool } from "../tools/rag.js";
import { scanVaultTool } from "../tools/scan-vault.js";
import { readMarkdownTool } from "../tools/read-markdown.js";

const deepseek = createOpenAICompatible({
  name: "deepseek",
  baseURL:
    (process.env.APOTHECARY_OPENAI_BASE_URL ?? "https://api.deepseek.com") +
    "/v1",
  apiKey: process.env.APOTHECARY_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
});

export const vaultReviewer = new Agent({
  id: "vault-reviewer",
  name: "Vault Reviewer",
  description:
    "Answers questions about Yuy's vault by searching and reading markdown files.",
  instructions:
    "You are apothecary-agent, Yuy's personal knowledge assistant. " +
    "Use queryVault to search for relevant content, scanVault to explore, and readMarkdown to inspect files. " +
    "Answer in Chinese when the user writes Chinese. Be concise. Always cite which files support your answer.",
  model: "deepseek/deepseek-v4-flash",
  tools: {
    queryVault: queryVaultTool,
    scanVault: scanVaultTool,
    readMarkdown: readMarkdownTool,
  },
});
