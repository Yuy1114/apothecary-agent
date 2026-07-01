import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { scanVaultTool, readMarkdownTool, writeReviewTool } from "../agent/tools.js";
import { queryVaultTool } from "../agent/queryVaultTool.js";
import { proposeEditTool } from "../agent/proposeEditTool.js";

const deepseek = createOpenAICompatible({
  name: "deepseek",
  baseURL: (process.env.APOTHECARY_OPENAI_BASE_URL ?? "https://api.deepseek.com") + "/v1",
  apiKey: process.env.APOTHECARY_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
});

export const vaultReviewer = new Agent({
  id: "vault-reviewer",
  name: "Vault Reviewer",
  description: "Read-only vault reviewer that produces knowledge maps and maintenance reviews for a local Markdown knowledge base.",
  instructions:
    "You are apothecary-agent, a read-only vault reviewer. " +
    "Review the vault and produce structured maintenance findings. " +
    "Use scanVault to explore the vault and readMarkdown to inspect files in detail. " +
    "When done, call writeReview to persist your findings.",
  model: deepseek("deepseek-chat"),
  tools: {
    scanVault: scanVaultTool,
    readMarkdown: readMarkdownTool,
    writeReview: writeReviewTool,
    queryVault: queryVaultTool,
    proposeEdit: proposeEditTool,
  },
});

export const mastra = new Mastra({
  agents: { vaultReviewer },
});
