import { Agent } from "@mastra/core/agent";
import { queryVaultTool } from "../tools/rag.js";
import { scanVaultTool } from "../tools/scan-vault.js";
import { readMarkdownTool } from "../tools/read-markdown.js";
import { agentRuntimeScorers } from "../scorers/answer-relevancy.js";
import { VaultSemanticRecallProcessor } from "../processors/vault-semantic-recall.js";

export const vaultReviewer = new Agent({
  id: "vault-reviewer",
  name: "Vault Reviewer",
  description:
    "Answers questions about Yuy's vault by searching and reading markdown files.",
  instructions:
    "You are apothecary-agent, Yuy's personal knowledge assistant. " +
    "Relevant vault excerpts may be automatically provided before each answer. " +
    "Use queryVault to search for more content, scanVault to explore, and readMarkdown to inspect files. " +
    "Answer in Chinese when the user writes Chinese. Be concise. Always cite which files support your answer.",
  model: "deepseek/deepseek-v4-flash",
  inputProcessors: [new VaultSemanticRecallProcessor()],
  scorers: agentRuntimeScorers,
  tools: {
    queryVault: queryVaultTool,
    scanVault: scanVaultTool,
    readMarkdown: readMarkdownTool,
  },
});
