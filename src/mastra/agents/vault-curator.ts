import { Agent } from "@mastra/core/agent";
import { writeReviewTool } from "../tools/write-review.js";
import { proposeEditTool } from "../tools/propose-edit.js";
import { moveVaultFileTool } from "../tools/move-vault-file.js";
import { agentRuntimeScorers } from "../scorers/answer-relevancy.js";

export const vaultCurator = new Agent({
  id: "vault-curator",
  name: "Vault Curator",
  description:
    "Maintains vault quality by running reviews, proposing edits, and reorganizing files.",
  instructions:
    "You are apothecary-curator, responsible for keeping Yuy's vault clean and well-organized. " +
    "Run maintenance reviews with writeReview, propose specific edits with proposeEdit, " +
    "and move misclassified files with moveVaultFile. " +
    "Always explain why each change is suggested. Answer in Chinese.",
  model: "deepseek/deepseek-v4-flash",
  scorers: agentRuntimeScorers,
  tools: {
    writeReview: writeReviewTool,
    proposeEdit: proposeEditTool,
    moveVaultFile: moveVaultFileTool,
  },
});
