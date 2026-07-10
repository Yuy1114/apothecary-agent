import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { requiresHumanApproval } from "./permissions.js";
import { resolveProposalById } from "../../application/proposals/resolveProposal.js";

export const resolveProposalTool = createTool({
  id: "resolveProposal",
  description:
    "Resolve a change proposal by id. 'approve' executes it against the vault (write/move/archive/merge) and marks it " +
    "applied; 'reject' records the decision and leaves every file untouched. Approving applies changes to user notes, so " +
    "this requires human approval. If the executor fails (e.g. the source moved), the proposal stays 'proposed' so it can " +
    "be fixed and retried. Check pending proposals first with listChangeProposals.",
  requireApproval: requiresHumanApproval,
  inputSchema: z.object({
    id: z.string().describe("The proposal id (e.g. 'prop-...')"),
    decision: z.enum(["approve", "reject"]),
    note: z.string().optional().describe("Optional reason recorded with the decision"),
  }),
  outputSchema: z.object({
    resolved: z.boolean(),
    proposalId: z.string(),
    type: z.string().optional(),
    status: z.string().optional(),
    reason: z.string().optional(),
  }),
  execute: async ({ id, decision, note }) => resolveProposalById(id, decision, note),
});
