import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { recordIntakeDecision, loadIntakePlan } from "../../vault/intakePlanStore.js";
import { IntakeDecisionSchema } from "../../domain/intakePlan.js";
import { classifyLayer } from "../../vault/classifyLayer.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";
import { nowIso } from "../../utils/time.js";

// The organizer supplies everything except the timestamp, which we stamp here.
const RecordDecisionInputSchema = IntakeDecisionSchema.omit({ decidedAt: true });

// A move must target one of the real vault content layers — never _inbox, and
// never the agent's private home (.apothecary/.agent live outside the vault).
const VALID_MOVE_LAYERS = new Set(["journal", "notes", "projects", "areas", "resources", "records", "media", "archive"]);

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
    error: z.string().optional().describe("Set when the decision was rejected; fix it and call again"),
  }),
  execute: async (input) => {
    // Reject an out-of-skeleton move (e.g. dest ".apothecary/…" or "_inbox/…")
    // so the organizer corrects it instead of writing a bad plan.
    if (input.action === "move") {
      const layer = input.dest ? classifyLayer(input.dest) : "unknown";
      if (!input.dest || !VALID_MOVE_LAYERS.has(layer)) {
        const total = (await loadIntakePlan(apothecaryHome())).decisions.length;
        return {
          recorded: false,
          source: input.source,
          total,
          error:
            `dest ${JSON.stringify(input.dest ?? null)} is not a vault directory. A move must target one of: ` +
            `notes/ journal/ areas/ projects/ resources/ records/ media/ archive/. ` +
            `Never .apothecary/ or .agent/ (the agent's private home, outside the vault) and never _inbox/. ` +
            `For the agent's own stale artifacts use action="archive".`,
        };
      }
    }
    const { total } = await recordIntakeDecision({ ...input, decidedAt: nowIso() }, apothecaryHome());
    return { recorded: true, source: input.source, total };
  },
});
