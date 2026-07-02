import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { resolveChanges } from "../../vault/changeLog.js";

export const resolvePendingChangesTool = createTool({
  id: "resolvePendingChanges",
  description:
    "Mark pending vault changes as handled. Use 'processed' once you have triaged/reviewed them, or 'dismissed' " +
    "if no action is needed. This only updates the change ledger — it does not modify any note.",
  inputSchema: z.object({
    ids: z.array(z.string()).describe("Change ids from listPendingChanges to resolve"),
    outcome: z.enum(["processed", "dismissed"]),
  }),
  outputSchema: z.object({ resolved: z.number() }),
  execute: async ({ ids, outcome }) => ({ resolved: await resolveChanges(ids, outcome) }),
});
