import { createStep, createWorkflow } from "@mastra/core/workflows";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { EditProposalSchema, applyProposal } from "../../domain/applyProposal.js";

const ApplyEditStateSchema = z.object({
  vaultPath: z.string(),
  proposalId: z.string(),
  proposal: EditProposalSchema,
});

const loadProposalStep = createStep({
  id: "load-edit-proposal",
  inputSchema: z.object({ vaultPath: z.string(), proposalId: z.string() }),
  outputSchema: ApplyEditStateSchema,
  execute: async ({ inputData }) => {
    const vaultPath = await resolveExistingDirectory(inputData.vaultPath);
    const proposalPath = path.join(vaultPath, ".agent", "edits", `${inputData.proposalId}.json`);
    const proposal = EditProposalSchema.parse(JSON.parse(await fs.readFile(proposalPath, "utf8")));

    if (proposal.status !== "proposed") {
      throw new Error(`Proposal ${proposal.id} is already ${proposal.status}.`);
    }

    return { vaultPath, proposalId: inputData.proposalId, proposal };
  },
});

const requestApprovalStep = createStep({
  id: "request-edit-approval",
  inputSchema: ApplyEditStateSchema,
  outputSchema: ApplyEditStateSchema.extend({ approved: z.boolean() }),
  suspendSchema: z.object({
    reason: z.string(),
    proposalId: z.string(),
    filePath: z.string(),
    title: z.string(),
    description: z.string(),
    suggestedContentPreview: z.string(),
    suggestedContentTruncated: z.boolean(),
  }),
  resumeSchema: z.object({ approved: z.boolean() }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      const previewLength = 800;
      return await suspend({
        reason: "Human approval required before applying an edit proposal to user vault content.",
        proposalId: inputData.proposal.id,
        filePath: inputData.proposal.filePath,
        title: inputData.proposal.title,
        description: inputData.proposal.description,
        suggestedContentPreview: inputData.proposal.suggestedContent.slice(0, previewLength),
        suggestedContentTruncated: inputData.proposal.suggestedContent.length > previewLength,
      });
    }

    return { ...inputData, approved: resumeData.approved };
  },
});

const applyEditStep = createStep({
  id: "apply-edit-proposal",
  inputSchema: ApplyEditStateSchema.extend({ approved: z.boolean() }),
  outputSchema: z.object({
    proposalId: z.string(),
    filePath: z.string(),
    applied: z.boolean(),
    status: z.enum(["proposed", "applied"]),
  }),
  execute: async ({ inputData }) => {
    const { vaultPath, proposal } = inputData;

    if (!inputData.approved) {
      return {
        proposalId: proposal.id,
        filePath: proposal.filePath,
        applied: false,
        status: "proposed" as const,
      };
    }

    return await applyProposal({ vaultPath, proposalId: proposal.id });
  },
});

export const applyEditWorkflow = createWorkflow({
  id: "apply-edit",
  inputSchema: z.object({ vaultPath: z.string(), proposalId: z.string() }),
  outputSchema: z.object({
    proposalId: z.string(),
    filePath: z.string(),
    applied: z.boolean(),
    status: z.enum(["proposed", "applied"]),
  }),
})
  .then(loadProposalStep)
  .then(requestApprovalStep)
  .then(applyEditStep)
  .commit();
