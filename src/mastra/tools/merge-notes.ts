import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { requiresHumanApproval } from "./permissions.js";
import { mergeNotesCore } from "./merge-notes-core.js";

export const mergeNotesTool = createTool({
  id: "mergeNotes",
  description:
    "Atomically merge one note into another: write the combined content into the canonical note and archive the " +
    "absorbed source, in a single approval and a single linked audit record. Use this for a harmful_duplicate instead " +
    "of a separate proposeEdit + archiveVaultFile. You supply the FULL merged content for the canonical note (read " +
    "both notes first and compose it). The canonical may be an existing note (updated) or a new path (created). The " +
    "source is archived non-destructively — never deleted. Writes a user note and moves a file, so it requires human " +
    "approval.",
  requireApproval: requiresHumanApproval,
  inputSchema: z.object({
    sourcePath: z.string().describe("The duplicate note to absorb and archive"),
    canonicalPath: z
      .string()
      .describe("The note that receives the merged content (existing or new); must differ from sourcePath"),
    canonicalContent: z.string().describe("The full merged content to write into the canonical note"),
    reason: z.string().optional().describe("Why these notes are being merged"),
  }),
  outputSchema: z.object({
    merged: z.boolean(),
    sourcePath: z.string(),
    canonicalPath: z.string(),
    archivedTo: z.string().optional(),
    reason: z.string().optional(),
  }),
  execute: async ({ sourcePath, canonicalPath, canonicalContent, reason }) =>
    mergeNotesCore({ sourcePath, canonicalPath, canonicalContent, reason }),
});
