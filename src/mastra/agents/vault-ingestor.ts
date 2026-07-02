import { Agent } from "@mastra/core/agent";
import { ingestVaultTool } from "../tools/ingest-vault.js";
import { readStructureTool } from "../tools/read-structure.js";
import { updateStructureKeywordsTool } from "../tools/update-structure-keywords.js";
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
    "First call readStructure to learn the exact directory keys. Decide the best-fit directory for the content, " +
    "then pass that exact key as ingestVault's `topic` so the note lands there directly — do not rely on keyword " +
    "auto-classification when you already know the right home.\n" +
    "After placing a note, do a concrete keyword-gap check: look at the chosen directory's current keywords and check " +
    "whether at least one of them LITERALLY appears in the content. If none of them appear, that directory has a " +
    "classification gap for this content — you MUST propose adding one or two representative keywords with " +
    "updateStructureKeywords (approval-gated). Do not claim the keywords already cover the content unless a keyword " +
    "literally appears in it. If updateStructureKeywords reports a conflict (the keyword already belongs to another " +
    "directory), tell Yuy instead of forcing it.\n" +
    "Always include a descriptive title and explain your placement. Answer in Chinese.",
  model: "deepseek/deepseek-v4-flash",
  scorers: agentRuntimeScorers,
  tools: {
    ingestVault: ingestVaultTool,
    readStructure: readStructureTool,
    updateStructureKeywords: updateStructureKeywordsTool,
  },
});
