import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { loadCanonicalCandidates } from "../../vault/semanticStore.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";

export const listCanonicalCandidatesTool = createTool({
  id: "listCanonicalCandidates",
  description:
    "List concepts that are spread across many notes and would benefit from a single canonical note " +
    "(.agent/semantic/canonical-candidates.json), highest priority first. Each entry has the concept, the notes " +
    "covering it, and how many are linked by duplicate/evolution relations. Use it to decide where to create or " +
    "update a canonical note (via an edit or merge proposal). Read-only; empty until the semantic layer has been built.",
  inputSchema: z.object({
    limit: z.number().optional().describe("Max candidates to return (default 15, by priority)"),
  }),
  outputSchema: z.object({
    candidates: z.array(
      z.object({
        concept: z.string(),
        files: z.array(z.string()),
        fileCount: z.number(),
        duplicatePairs: z.number(),
        evolutionPairs: z.number(),
        score: z.number(),
      }),
    ),
  }),
  execute: async ({ limit }) => {
    const { candidates } = await loadCanonicalCandidates(apothecaryHome());
    return { candidates: candidates.slice(0, limit ?? 15) };
  },
});
