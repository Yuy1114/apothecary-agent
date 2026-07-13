import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { PolishModeSchema } from "../../domain/notePolish.js";
import { polishNote } from "../../application/notes/polishNote.js";
import { mastraNotePolisher } from "../adapters/mastraNotePolisher.js";

const InputSchema = z.object({
  vaultPath: z.string(),
  filePath: z.string(),
  modes: z.array(PolishModeSchema).min(1),
});

const OutputSchema = z.object({
  proposalId: z.string(),
  filePath: z.string(),
  changeSummary: z.string(),
});

const resolveVaultStep = createStep({
  id: "resolve-vault",
  inputSchema: InputSchema,
  outputSchema: InputSchema,
  execute: async ({ inputData }) => ({
    ...inputData,
    vaultPath: await resolveExistingDirectory(inputData.vaultPath),
  }),
});

const polishStep = createStep({
  id: "polish-note",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async ({ inputData }) => {
    const { vaultPath, filePath, modes } = inputData;
    const result = await polishNote({ vaultPath, filePath, modes }, mastraNotePolisher);
    return {
      proposalId: result.proposalId,
      filePath: result.filePath,
      changeSummary: result.changeSummary,
    };
  },
});

/**
 * Polish one note into an `edit` proposal (never a direct write). Exists so the
 * flow is drivable/debuggable from Studio; the desktop calls the use case
 * directly and chat goes through the polishNote tool.
 */
export const polishNoteWorkflow = createWorkflow({
  id: "polish-note",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
})
  .then(resolveVaultStep)
  .then(polishStep)
  .commit();
