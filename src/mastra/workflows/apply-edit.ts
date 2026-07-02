import { createStep, createWorkflow } from "@mastra/core/workflows";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";

const EditProposalSchema = z.object({
  id: z.string().min(1),
  filePath: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  currentContent: z.string(),
  suggestedContent: z.string(),
  status: z.enum(["proposed", "applied", "rejected"]),
  createdAt: z.string(),
});

type EditProposal = z.infer<typeof EditProposalSchema>;

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

    const filePath = path.join(vaultPath, proposal.filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    if (proposal.suggestedContent) {
      await fs.writeFile(filePath, proposal.suggestedContent, "utf8");
    }

    await fs.writeFile(
      path.join(vaultPath, ".agent", "edits", `${proposal.id}.json`),
      JSON.stringify({ ...proposal, status: "applied" satisfies EditProposal["status"] }, null, 2),
      "utf8",
    );

    return {
      proposalId: proposal.id,
      filePath: proposal.filePath,
      applied: true,
      status: "applied" as const,
    };
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
