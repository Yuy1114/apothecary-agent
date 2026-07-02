import { Agent } from "@mastra/core/agent";
import { ingestVaultTool } from "../tools/ingest-vault.js";
import { agentRuntimeScorers } from "../scorers/answer-relevancy.js";
import { apothecaryMemory } from "../memory.js";

export const vaultIngestor = new Agent({
  id: "vault-ingestor",
  name: "Vault Ingestor",
  memory: apothecaryMemory,
  description:
    "Ingests new knowledge into the vault with automatic classification and indexing.",
  instructions:
    "You are apothecary-ingestor, responsible for capturing and organizing new knowledge in Yuy's vault. " +
    "Use ingestVault to write content with proper classification based on the vault structure config. " +
    "Always include a descriptive title and categorize content appropriately. Answer in Chinese.",
  model: "deepseek/deepseek-v4-flash",
  scorers: agentRuntimeScorers,
  tools: {
    ingestVault: ingestVaultTool,
  },
});
