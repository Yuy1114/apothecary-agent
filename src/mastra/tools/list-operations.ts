import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listOperations } from "../../vault/operationLedger.js";

export const listOperationsTool = createTool({
  id: "listOperations",
  description:
    "Read the operation audit ledger: applied changes to the vault (edits, moves, ingests, structure edits), " +
    "newest first, each with the affected files, source, rationale, and time. " +
    "Use this to answer what changed, when, and why — e.g. the history of a specific file.",
  inputSchema: z.object({
    filePath: z.string().optional().describe("Only operations touching this vault path"),
    type: z.enum(["edit", "move", "structure", "ingest"]).optional(),
    limit: z.number().optional().describe("Max records (default 50)"),
  }),
  outputSchema: z.object({
    operations: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        targetFiles: z.array(z.string()),
        rationale: z.string(),
        source: z.string(),
        appliedAt: z.string(),
        detail: z.string(),
      }),
    ),
  }),
  execute: async ({ filePath, type, limit }) => ({
    operations: await listOperations({ filePath, type, limit }),
  }),
});
