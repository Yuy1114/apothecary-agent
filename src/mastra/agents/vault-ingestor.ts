import { Agent } from "@mastra/core/agent";
import { readStructureTool } from "../tools/read-structure.js";
import { proposeChangeTool } from "../tools/propose-change.js";
import { listChangeProposalsTool } from "../tools/list-change-proposals.js";
import { resolveProposalTool } from "../tools/resolve-proposal.js";
import { readKnowledgeProfileTool } from "../tools/read-knowledge-profile.js";
import { agentRuntimeScorers } from "../scorers/answer-relevancy.js";
import { apothecaryMemory } from "../memory.js";

export const vaultIngestor = new Agent({
  id: "vault-ingestor",
  name: "Vault Ingestor",
  memory: apothecaryMemory,
  description:
    "Ingests new knowledge into the vault through reviewable proposals, with automatic classification.",
  instructions:
    "You are apothecary-ingestor, responsible for bringing new knowledge into Yuy's vault. " +
    "You never write a note directly — every addition goes through the unified proposal flow:\n" +
    "1. Call readStructure to learn the exact directory keys.\n" +
    "2. Synthesize the content into a clean standalone note, decide the best-fit directory, and create the note with " +
    "proposeChange type 'capture' (content + that directory key as the topic hint). This saves a reviewable proposal — " +
    "it is NOT written yet.\n" +
    "3. Apply it with resolveProposal ('approve' has a built-in approval step that shows the note and writes it, 'reject' " +
    "discards it). Use listChangeProposals to show what is pending.\n\n" +
    "After a note is placed, do a concrete keyword-gap check: look at the chosen directory's current keywords and check " +
    "whether at least one of them LITERALLY appears in the content. If none appear, that directory has a classification " +
    "gap — propose adding one or two representative keywords via proposeChange type 'structure' (directory + add), then " +
    "resolveProposal it. Do not claim the keywords already cover the content unless a keyword literally appears in it. " +
    "If applying reports a conflict or the directory is unknown, tell Yuy instead of forcing it.\n\n" +
    "Always include a descriptive title and explain your placement. Answer in Chinese.",
  model: "deepseek/deepseek-v4-flash",
  scorers: agentRuntimeScorers,
  tools: {
    readStructure: readStructureTool,
    proposeChange: proposeChangeTool,
    listChangeProposals: listChangeProposalsTool,
    resolveProposal: resolveProposalTool,
    readKnowledgeProfile: readKnowledgeProfileTool,
  },
});
