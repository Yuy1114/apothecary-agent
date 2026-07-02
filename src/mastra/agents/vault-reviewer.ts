import { Agent } from "@mastra/core/agent";
import { queryVaultTool } from "../tools/rag.js";
import { scanVaultTool } from "../tools/scan-vault.js";
import { readMarkdownTool } from "../tools/read-markdown.js";
import { readFileSummaryTool } from "../tools/read-file-summary.js";
import { listSemanticTopicsTool } from "../tools/list-semantic-topics.js";
import { findRelatedFilesTool } from "../tools/find-related-files.js";
import { generateKnowledgeViewTool } from "../tools/generate-knowledge-view.js";
import { listOperationsTool } from "../tools/list-operations.js";
import { captureInsightTool } from "../tools/capture-insight.js";
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
    "When the user asks for an overview or knowledge system of some direction/subject, use generateKnowledgeView to build a structured view. " +
    "When a durable insight surfaces worth keeping long-term (a decision, principle, learning conclusion, or job-evidence point), you may offer to save it. " +
    "When the user asks to save an insight or accepts your offer, CALL captureInsight (synthesize clean note content + a topic hint) — do NOT ask for confirmation in prose. " +
    "captureInsight has a built-in approval step that shows the content and lets the user approve or reject before anything is written; that step IS the confirmation. " +
    "Do not capture trivial or transient chatter. " +
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
    captureInsight: captureInsightTool,
    readKnowledgeProfile: readKnowledgeProfileTool,
  },
});
