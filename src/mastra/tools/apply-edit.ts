import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { applyProposal } from "../../domain/applyProposal.js";
import { requiresHumanApproval } from "./permissions.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export const applyEditTool = createTool({
  id: "applyEdit",
  description:
    "Apply a previously created edit proposal to its target vault file. " +
    "Writes the proposal's suggested content to the file and marks the proposal as applied. " +
    "This modifies user note content, so it requires human approval. " +
    "The proposal must still be in 'proposed' state (use listProposals to check).",
  requireApproval: requiresHumanApproval,
  inputSchema: z.object({
    proposalId: z.string().describe("The id of the edit proposal to apply, e.g. 'edit-...'"),
  }),
  outputSchema: z.object({
    proposalId: z.string(),
    filePath: z.string(),
    applied: z.boolean(),
    status: z.string(),
  }),
  execute: async ({ proposalId }) => {
    return await applyProposal({ vaultPath: VAULT_PATH, proposalId });
  },
});
