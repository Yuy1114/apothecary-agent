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
    case "capture":
      return { content: input.content, topic: input.topic };
    case "structure":
      return { directory: input.directory, add: input.add, remove: input.remove };
    case "view_promotion":
      return {
        sourceViewPath: input.sourceViewPath,
        targetPath: input.targetPath,
        content: input.content,
      };
    case "canonical_note":
      return {
        canonicalPath: input.canonicalPath,
        content: input.content,
        supersedes: input.supersedes ?? [],
      };
  }
}

export const proposeChangeTool = createTool({
  id: "proposeChange",
  description:
    "Create a reviewable proposal for a change to the human-readable vault — the unified, audited way to propose ANY " +
    "change. It is NOT applied automatically: it is saved for the user to review (listChangeProposals) and then approve " +
    "or reject (resolveProposal). Provide the fields for the chosen type:\n" +
    "- edit: filePath + suggestedContent (full new content)\n" +
    "- move: from + to\n" +
    "- archive: from\n" +
    "- merge: sourcePath + canonicalPath + canonicalContent (full merged content)\n" +
    "- capture: content (the synthesized note) + optional topic (directory hint)\n" +
    "- structure: directory + add and/or remove (classification keywords)\n" +
    "- view_promotion: sourceViewPath (.agent/views/...) + targetPath + content (the note to write)\n" +
    "- canonical_note: canonicalPath + content (the canonical note) + supersedes (older notes it replaces; each is " +
    "stamped with a superseded_by link)\n" +
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
    canonicalPath: z.string().optional().describe("merge/canonical_note: the note to keep/canonicalize"),
    canonicalContent: z.string().optional().describe("merge: full merged content"),
    content: z.string().optional().describe("capture/view_promotion: the note content to write"),
    topic: z.string().optional().describe("capture: directory hint, e.g. 'reflections/'"),
    directory: z.string().optional().describe("structure: exact directory key"),
    add: z.array(z.string()).optional().describe("structure: keywords to add"),
    remove: z.array(z.string()).optional().describe("structure: keywords to remove"),
    sourceViewPath: z.string().optional().describe("view_promotion: source .agent/views path"),
    targetPath: z.string().optional().describe("view_promotion: target vault note path"),
    supersedes: z
      .array(z.string())
      .optional()
      .describe("canonical_note: older note paths this canonical note replaces"),
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
