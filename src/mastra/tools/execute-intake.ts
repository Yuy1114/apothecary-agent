import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { executeIntake } from "./execute-intake-core.js";

export const executeIntakeTool = createTool({
  id: "executeIntake",
  description:
    "Apply the reviewed intake plan (~/.apothecary/queue/intake-plan.json): move/archive each _inbox file per its " +
    "decision (leave = keep in _inbox), stamping tags onto moved markdown. Reuses the audited move/archive cores, so " +
    "the search index and operation ledger stay in sync and nothing is overwritten or deleted. " +
    "Call this only after the user has reviewed the plan and asked to apply it. The plan is consumed on completion; " +
    "afterward, tell the user to run a semantic refresh to rebuild the understanding layer for the moved files.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    total: z.number(),
    moved: z.number(),
    archived: z.number(),
    left: z.number(),
    failed: z.number(),
    failures: z.array(z.object({ source: z.string(), reason: z.string() })),
  }),
  // Native Mastra approval: pauses before executing so the human approves the
  // whole batch; the request bubbles up through the supervisor to the user.
  requireApproval: true,
  execute: async () => executeIntake(),
});
