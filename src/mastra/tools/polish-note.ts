import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import path from "node:path";
import { PolishModeSchema } from "../../domain/notePolish.js";
import { polishNote } from "../../application/notes/polishNote.js";
import { mastraNotePolisher } from "../adapters/mastraNotePolisher.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export const polishNoteTool = createTool({
  id: "polishNote",
  description:
    "Polish one existing vault note per the user-selected modes and record the result as an `edit` " +
    "proposal for the user to review — the note is NEVER modified directly. Modes:\n" +
    "- expand: continue/deepen the note, drawing on related notes from the vault\n" +
    "- format: fix heading structure and highlight key points without changing meaning\n" +
    "- tags: suggest additional frontmatter tags\n" +
    "Pass only the modes the user asked for. The proposal shows a before/after diff at review time.",
  inputSchema: z.object({
    filePath: z.string().describe("Vault-relative path of the .md note to polish"),
    modes: z.array(PolishModeSchema).min(1).describe("The polish modes the user selected"),
  }),
  outputSchema: z.object({
    proposalId: z.string(),
    status: z.string(),
    changeSummary: z.string().optional(),
    targetFiles: z.array(z.string()).optional(),
    note: z.string().optional(),
  }),
  // Same desktop decision gate as proposeChange: when the caller opts in via
  // requestContext, the run suspends after recording the proposal until the
  // human approves/rejects, then resumes in-context with the outcome. Callers
  // that do not opt in (e.g. Mastra Studio) get fire-and-forget behaviour.
  suspendSchema: z.object({
    proposalId: z.string(),
    title: z.string(),
    type: z.string(),
    targetFiles: z.array(z.string()),
  }),
  resumeSchema: z.object({
    proposalId: z.string(),
    decision: z.enum(["applied", "rejected", "failed"]),
    note: z.string().optional(),
  }),
  execute: async ({ filePath, modes }, context) => {
    // Resumed run: the proposal already exists and the human decision is in.
    // Checked first so a resume never re-runs the polish itself.
    const resumed = context?.agent?.resumeData;
    if (resumed) {
      return { proposalId: resumed.proposalId, status: resumed.decision, note: resumed.note };
    }

    const result = await polishNote({ vaultPath: VAULT_PATH, filePath, modes }, mastraNotePolisher);

    const awaitDecision = Boolean(context?.requestContext?.get("awaitDesktopDecision"));
    const suspend = context?.agent?.suspend;
    if (awaitDecision && suspend) {
      await suspend({
        proposalId: result.proposalId,
        title: `润色：${path.posix.basename(result.filePath)}`,
        type: "edit",
        targetFiles: [result.filePath],
      });
    }

    return {
      proposalId: result.proposalId,
      status: "proposed",
      changeSummary: result.changeSummary,
      targetFiles: [result.filePath],
    };
  },
});
