import { Agent } from "@mastra/core/agent";
import { queryVaultTool } from "../tools/rag.js";
import { scanVaultTool } from "../tools/scan-vault.js";
import { readMarkdownTool } from "../tools/read-markdown.js";
import { readFileSummaryTool } from "../tools/read-file-summary.js";
import { listSemanticTopicsTool } from "../tools/list-semantic-topics.js";
import { findRelatedFilesTool } from "../tools/find-related-files.js";
import { generateKnowledgeViewTool } from "../tools/generate-knowledge-view.js";
import { listOperationsTool } from "../tools/list-operations.js";
import { proposeChangeTool } from "../tools/propose-change.js";
import { listChangeProposalsTool } from "../tools/list-change-proposals.js";
import { resolveProposalTool } from "../tools/resolve-proposal.js";
import { readKnowledgeProfileTool } from "../tools/read-knowledge-profile.js";
import { agentRuntimeScorers } from "../scorers/answer-relevancy.js";
import { VaultSemanticRecallProcessor } from "../processors/vault-semantic-recall.js";
import { apothecaryMemory } from "../memory.js";

export const vaultReviewer = new Agent({
  id: "vault-reviewer",
  name: "Vault Reviewer",
  memory: apothecaryMemory,
  description:
    "Answers questions about Yuy's vault by searching and reading markdown files.",
  instructions:
    "You are apothecary-agent, Yuy's personal knowledge assistant. " +
    "Relevant vault excerpts may be automatically provided before each answer. " +
    "Use queryVault to search for more content, scanVault to explore, and readMarkdown to inspect files. " +
    "Use readFileSummary to get a file's semantic summary (gist, topics, concepts) without reading the whole file. " +
    "Use listSemanticTopics for a birds-eye view of the vault's topics/concepts, and findRelatedFiles to find notes related to a given file. " +
    "When the user asks for an overview or knowledge system of some direction/subject, use generateKnowledgeView to build a structured view (stored in the agent's private workspace). " +
    "Every change to the vault goes through the unified proposal flow — never write a note directly:\n" +
    "- To save a durable insight (a decision, principle, learning conclusion, or job-evidence point), synthesize clean standalone note content and call proposeChange type 'capture' (content + a topic hint). Do not capture trivial or transient chatter.\n" +
    "- To turn a generated view into a permanent vault note, call proposeChange type 'view_promotion' (sourceViewPath = the view path returned by generateKnowledgeView, targetPath, content).\n" +
    "proposeChange only records a reviewable proposal; then apply it with resolveProposal ('approve' has a built-in approval step that shows the change and writes it, 'reject' discards it) — that approval step IS the confirmation, so do not also ask in prose. Use listChangeProposals to show what is pending. " +
    "Answer in Chinese when the user writes Chinese. Be concise. Always cite which files support your answer.",
  model: "deepseek/deepseek-v4-flash",
  inputProcessors: [new VaultSemanticRecallProcessor()],
  scorers: agentRuntimeScorers,
  tools: {
    queryVault: queryVaultTool,
    scanVault: scanVaultTool,
    readMarkdown: readMarkdownTool,
    readFileSummary: readFileSummaryTool,
    listSemanticTopics: listSemanticTopicsTool,
    findRelatedFiles: findRelatedFilesTool,
    generateKnowledgeView: generateKnowledgeViewTool,
    listOperations: listOperationsTool,
    proposeChange: proposeChangeTool,
    listChangeProposals: listChangeProposalsTool,
    resolveProposal: resolveProposalTool,
    readKnowledgeProfile: readKnowledgeProfileTool,
  },
});
