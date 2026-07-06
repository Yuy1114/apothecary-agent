import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { detectSupersededNotes } from "../../application/maintenance/detectSupersededNotes.js";
import { buildMaintenanceFindings } from "../../domain/maintenanceFindings.js";
import { loadCanonicalCandidates } from "../../vault/semanticStore.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export const listMaintenanceFindingsTool = createTool({
  id: "listMaintenanceFindings",
  description:
    "One prioritized maintenance worklist, each item mapped to the proposal that resolves it: 'superseded' notes still " +
    "active (→ archive them) come first, then 'scattered' concepts spread across many notes (→ create a canonical note). " +
    "Read-only. Use it to decide what to clean up next, then act via proposeChange.",
  inputSchema: z.object({
    limit: z.number().optional().describe("Max findings to return (default 20)"),
  }),
  outputSchema: z.object({
    findings: z.array(
      z.object({
        type: z.string(),
        files: z.array(z.string()),
        suggestedAction: z.string(),
        detail: z.string(),
      }),
    ),
  }),
  execute: async ({ limit }) => {
    const [superseded, { candidates }] = await Promise.all([
      detectSupersededNotes(VAULT_PATH),
      loadCanonicalCandidates(apothecaryHome()),
    ]);
    const findings = buildMaintenanceFindings({ superseded, candidates });
    return { findings: findings.slice(0, limit ?? 20) };
  },
});
