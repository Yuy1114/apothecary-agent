import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ProposalTypeSchema, ProposalStatusSchema } from "../../domain/proposal.js";
import { listProposalRecords } from "../../application/proposals/resolveProposal.js";

export const listChangeProposalsTool = createTool({
  id: "listChangeProposals",
  description:
    "List unified change proposals (edit/move/archive/merge), most recent first, with their lifecycle status " +
    "(proposed/applied/rejected). Use it to show the user what is pending review, or to audit what was applied or " +
    "rejected and why. Filter by status or type. Read-only — showing the list changes nothing.",
  inputSchema: z.object({
    status: ProposalStatusSchema.optional().describe("Filter by lifecycle status"),
    type: ProposalTypeSchema.optional().describe("Filter by proposal type"),
  }),
  outputSchema: z.object({
    proposals: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        status: z.string(),
        title: z.string(),
        targetFiles: z.array(z.string()),
        createdAt: z.string(),
        resolvedAt: z.string().optional(),
        resolutionNote: z.string().optional(),
      }),
    ),
  }),
  execute: async ({ status, type }) => {
    const proposals = await listProposalRecords({ status, type });
    return {
      proposals: proposals.map((p) => ({
        id: p.id,
        type: p.type,
        status: p.status,
        title: p.title,
        targetFiles: p.targetFiles,
        createdAt: p.createdAt,
        resolvedAt: p.resolvedAt,
        resolutionNote: p.resolutionNote,
      })),
    };
  },
});
