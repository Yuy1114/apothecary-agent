import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getAgentArtifacts } from "../../artifacts/agentArtifacts.js";
import { DuplicateReportSchema, DuplicateClassificationSchema } from "../../domain/duplicateDetection.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export const listDuplicateClustersTool = createTool({
  id: "listDuplicateClusters",
  description:
    "Read the duplicate-detection report (from the detect-duplicates workflow): pairs of overlapping notes classified " +
    "as harmful_duplicate / contextual_repetition / evolutionary_duplicate, each with a recommended action and rationale. " +
    "Use this to propose cleanup: merge/archive harmful duplicates, create a canonical note for contextual repetition, or " +
    "mark the older note superseded for evolutionary duplicates — all via proposeEdit / moveVaultFile (which require approval).",
  inputSchema: z.object({
    classification: DuplicateClassificationSchema.optional().describe("Filter to one classification"),
  }),
  outputSchema: z.object({
    generatedAt: z.string(),
    clusters: z.array(
      z.object({
        files: z.array(z.string()),
        sharedConcepts: z.array(z.string()),
        classification: z.string(),
        recommendedAction: z.string(),
        rationale: z.string(),
      }),
    ),
  }),
  execute: async ({ classification }) => {
    const reportPath = path.join(getAgentArtifacts(VAULT_PATH).semanticDir, "duplicate-clusters.json");
    let report;
    try {
      report = DuplicateReportSchema.parse(JSON.parse(await fs.readFile(reportPath, "utf8")));
    } catch {
      return { generatedAt: "", clusters: [] };
    }
    const clusters = report.clusters
      .filter((c) => !classification || c.classification === classification)
      .map((c) => ({
        files: c.files,
        sharedConcepts: c.sharedConcepts,
        classification: c.classification,
        recommendedAction: c.recommendedAction,
        rationale: c.rationale,
      }));
    return { generatedAt: report.generatedAt, clusters };
  },
});
