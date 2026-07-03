import { Agent } from "@mastra/core/agent";
import { writeReviewTool } from "../tools/write-review.js";
import { proposeEditTool } from "../tools/propose-edit.js";
import { moveVaultFileTool } from "../tools/move-vault-file.js";
import { archiveVaultFileTool } from "../tools/archive-vault-file.js";
import { mergeNotesTool } from "../tools/merge-notes.js";
import { readReviewTool } from "../tools/read-review.js";
import { applyEditTool } from "../tools/apply-edit.js";
import { listProposalsTool } from "../tools/list-proposals.js";
import { scanVaultTool } from "../tools/scan-vault.js";
import { readMarkdownTool } from "../tools/read-markdown.js";
import { readStructureTool } from "../tools/read-structure.js";
import { listPendingChangesTool } from "../tools/list-pending-changes.js";
import { resolvePendingChangesTool } from "../tools/resolve-pending-changes.js";
import { syncSemanticsTool } from "../tools/sync-semantics.js";
import { findRelatedFilesTool } from "../tools/find-related-files.js";
import { listOperationsTool } from "../tools/list-operations.js";
import { listDuplicateClustersTool } from "../tools/list-duplicate-clusters.js";
import { readKnowledgeProfileTool } from "../tools/read-knowledge-profile.js";
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
    "syncSemantics refreshes the agent's own semantic layer (file summaries + topic/concept graph) for the changed files. " +
    "It does not touch user notes and does not clear the pending-change queue, so it is always safe to run — use it after " +
    "notes have changed (or before duplicate/profile work) so later reasoning sees up-to-date understanding.\n\n" +
    "Use listDuplicateClusters to review detected duplicates and EXECUTE the fix with approval-gated, non-destructive tools:\n" +
    "- harmful_duplicate → merge: read both notes, compose the combined content, and call mergeNotes (sourcePath = the " +
    "copy to absorb, canonicalPath = the note to keep, canonicalContent = the full merged text). mergeNotes writes the " +
    "canonical and archives the copy in ONE approval and one linked audit record — prefer it over doing proposeEdit + " +
    "archiveVaultFile separately.\n" +
    "- contextual_repetition → keep both; create/update a canonical note and add references. Do NOT archive either file.\n" +
    "- evolutionary_duplicate → keep the chain; mark the older note superseded (proposeEdit its frontmatter/header), and only " +
    "archiveVaultFile it if it is fully absorbed. Never permanently delete — archiveVaultFile is the retirement path.\n\n" +
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
    archiveVaultFile: archiveVaultFileTool,
    mergeNotes: mergeNotesTool,
    listPendingChanges: listPendingChangesTool,
    resolvePendingChanges: resolvePendingChangesTool,
    syncSemantics: syncSemanticsTool,
    findRelatedFiles: findRelatedFilesTool,
    listOperations: listOperationsTool,
    listDuplicateClusters: listDuplicateClustersTool,
    readKnowledgeProfile: readKnowledgeProfileTool,
  },
});
