import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ProposalTypeSchema, type ProposalType } from "../../domain/proposal.js";
import { createProposal } from "../../vault/proposalStore.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

/** Assemble the type-specific payload from the tool's flat input fields. */
function buildPayload(type: ProposalType, input: Record<string, unknown>): unknown {
  switch (type) {
    case "edit":
      return { filePath: input.filePath, suggestedContent: input.suggestedContent };
    case "move":
      return { from: input.from, to: input.to };
    case "archive":
      return { from: input.from };
    case "merge":
      return {
        sourcePath: input.sourcePath,
        canonicalPath: input.canonicalPath,
        canonicalContent: input.canonicalContent,
      };
  }
}

export const proposeChangeTool = createTool({
  id: "proposeChange",
  description:
    "Create a reviewable proposal for a change to the human-readable vault — the unified, audited way to propose any " +
    "edit/move/archive/merge. It is NOT applied automatically: it is saved for the user to review (listChangeProposals) " +
    "and then approve or reject (resolveProposal). Provide the fields for the chosen type:\n" +
    "- edit: filePath + suggestedContent (full new content)\n" +
    "- move: from + to\n" +
    "- archive: from\n" +
    "- merge: sourcePath + canonicalPath + canonicalContent (full merged content)\n" +
    "Always give a clear title and rationale.",
  inputSchema: z.object({
    type: ProposalTypeSchema,
    title: z.string().describe("Short title for the proposed change"),
    rationale: z.string().describe("Why this change is proposed"),
    filePath: z.string().optional().describe("edit: the file to write"),
    suggestedContent: z.string().optional().describe("edit: full new content"),
    from: z.string().optional().describe("move/archive: current path"),
    to: z.string().optional().describe("move: target path"),
    sourcePath: z.string().optional().describe("merge: duplicate to absorb"),
    canonicalPath: z.string().optional().describe("merge: note to keep"),
    canonicalContent: z.string().optional().describe("merge: full merged content"),
  }),
  outputSchema: z.object({
    proposalId: z.string(),
    type: z.string(),
    status: z.string(),
    targetFiles: z.array(z.string()),
  }),
  execute: async ({ type, title, rationale, ...fields }) => {
    const proposal = await createProposal(VAULT_PATH, {
      type,
      title,
      rationale,
      payload: buildPayload(type, fields),
    });
    return {
      proposalId: proposal.id,
      type: proposal.type,
      status: proposal.status,
      targetFiles: proposal.targetFiles,
    };
  },
});
