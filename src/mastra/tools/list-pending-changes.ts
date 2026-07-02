import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listPendingChanges } from "../../vault/changeLog.js";

export const listPendingChangesTool = createTool({
  id: "listPendingChanges",
  description:
    "List vault changes the file watcher recorded as pending agent-work (created/modified/deleted notes). " +
    "Use this to see what has changed and may need triage or review, then act and mark them resolved with resolvePendingChanges.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    changes: z.array(
      z.object({
        id: z.string(),
        path: z.string(),
        changeType: z.string(),
        source: z.string(),
        detectedAt: z.string(),
      }),
    ),
  }),
  execute: async () => ({ changes: await listPendingChanges() }),
});
