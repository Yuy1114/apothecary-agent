import { Agent } from "@mastra/core/agent";
import { writeReviewTool } from "../tools/write-review.js";
import { proposeEditTool } from "../tools/propose-edit.js";
import { moveVaultFileTool } from "../tools/move-vault-file.js";
import { readReviewTool } from "../tools/read-review.js";
import { applyEditTool } from "../tools/apply-edit.js";
import { listProposalsTool } from "../tools/list-proposals.js";
import { scanVaultTool } from "../tools/scan-vault.js";
import { readMarkdownTool } from "../tools/read-markdown.js";
import { readStructureTool } from "../tools/read-structure.js";
import { listPendingChangesTool } from "../tools/list-pending-changes.js";
import { resolvePendingChangesTool } from "../tools/resolve-pending-changes.js";
import { findRelatedFilesTool } from "../tools/find-related-files.js";
import { listOperationsTool } from "../tools/list-operations.js";
import { agentRuntimeScorers } from "../scorers/answer-relevancy.js";
import { apothecaryMemory } from "../memory.js";

export const vaultCurator = new Agent({
  id: "vault-curator",
  name: "Vault Curator",
  memory: apothecaryMemory,
  description:
    "Maintains vault quality end-to-end: reviews findings, proposes edits, and applies approved changes.",
  instructions:
    "You are apothecary-curator, responsible for keeping Yuy's vault clean and well-organized. " +
    "You run a closed maintenance loop:\n" +
    "1. Read the latest maintenance review with readReview (or record a fresh one with writeReview).\n" +
    "2. For each actionable finding, draft a concrete fix and register it with proposeEdit " +
    "(include the full suggested content), or fix misclassified locations with moveVaultFile.\n" +
    "3. Use listProposals to see which proposals are still pending.\n" +
    "4. Apply a proposal with applyEdit once it is ready — this requires human approval before " +
    "any user note is changed.\n\n" +
    "You also triage the inbox (files waiting to be classified):\n" +
    "1. Read the vault layout with readStructure.\n" +
    "2. List pending files with scanVault (scopePath: \"inbox\").\n" +
    "3. Read each file's content with readMarkdown.\n" +
    "4. Pick the best target directory from the structure and move the file there with moveVaultFile — " +
    "this requires human approval and automatically keeps the search index in sync.\n\n" +
    "The file watcher records changed/created/deleted notes as pending work. " +
    "listPendingChanges is read-only inspection — showing the list must NOT change anything. " +
    "Only call resolvePendingChanges when the user explicitly asks to clear items, or right after you have actually " +
    "triaged/edited a specific change; state which ids you are resolving and why. Never dismiss items just because you were asked to list them. " +
    "When the user names the outcome (processed or dismissed), use exactly that — do not silently substitute the other; " +
    "if you believe a different outcome fits better, say so and let the user decide.\n\n" +
    "Always explain why each change or placement is suggested, and never act on low-confidence findings without saying so. " +
    "You may never delete user files or run shell commands. Answer in Chinese.",
  model: "deepseek/deepseek-v4-flash",
  scorers: agentRuntimeScorers,
  tools: {
    readReview: readReviewTool,
    writeReview: writeReviewTool,
    proposeEdit: proposeEditTool,
    listProposals: listProposalsTool,
    applyEdit: applyEditTool,
    readStructure: readStructureTool,
    scanVault: scanVaultTool,
    readMarkdown: readMarkdownTool,
    moveVaultFile: moveVaultFileTool,
    listPendingChanges: listPendingChangesTool,
    resolvePendingChanges: resolvePendingChangesTool,
    findRelatedFiles: findRelatedFilesTool,
    listOperations: listOperationsTool,
  },
});
