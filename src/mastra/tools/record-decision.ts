import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { recordIntakeDecision } from "../../vault/intakePlanStore.js";
import { IntakeDecisionSchema } from "../../domain/intakePlan.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";
import { nowIso } from "../../utils/time.js";

// The organizer supplies everything except the timestamp, which we stamp here.
const RecordDecisionInputSchema = IntakeDecisionSchema.omit({ decidedAt: true });

export const recordDecisionTool = createTool({
  id: "recordDecision",
  description:
    "Record your placement decision for ONE _inbox entry into the durable intake plan (nothing is moved yet). " +
    "Call it once per entry — files individually, a directory or package as a single unit. " +
    "`dest` is the target skeleton directory for a move (notes/ journal/ areas/ projects/ resources/ records/ media/); " +
    "use action='leave' to keep a low-confidence item in _inbox, action='archive' for junk or derived files. " +
    "Re-recording the same source overwrites the earlier decision. Returns the running total so you can track coverage.",
  inputSchema: RecordDecisionInputSchema,
  outputSchema: z.object({
    recorded: z.boolean(),
    source: z.string(),
    total: z.number().describe("Decisions recorded so far"),
  }),
  execute: async (input) => {
    const { total } = await recordIntakeDecision({ ...input, decidedAt: nowIso() }, apothecaryHome());
    return { recorded: true, source: input.source, total };
  },
});
