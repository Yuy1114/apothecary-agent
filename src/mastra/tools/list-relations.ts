import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { loadRelations } from "../../vault/semanticStore.js";
import { RelationTypeSchema } from "../../domain/relations.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export const listRelationsTool = createTool({
  id: "listRelations",
  description:
    "List typed relationships between notes from the semantic relation layer (.agent/semantic/relations.json): " +
    "related_to (shared concepts), duplicates (harmful copy), supersedes (evolutionary chain). Each edge has a weight " +
    "and the shared topics/concepts. Filter by a file (edges touching it) and/or type. Read-only — use it to spot " +
    "duplicate/superseded notes and explore the knowledge network. Returns empty until the semantic layer has been built.",
  inputSchema: z.object({
    filePath: z.string().optional().describe("Only edges touching this relative vault path"),
    type: RelationTypeSchema.optional().describe("Only edges of this relation type"),
    limit: z.number().optional().describe("Max edges to return (default 20, by weight)"),
  }),
  outputSchema: z.object({
    relations: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        type: z.string(),
        weight: z.number(),
        sharedTopics: z.array(z.string()),
        sharedConcepts: z.array(z.string()),
      }),
    ),
  }),
  execute: async ({ filePath, type, limit }) => {
    const { relations } = await loadRelations(VAULT_PATH);
    const filtered = relations.filter(
      (r) =>
        (!filePath || r.from === filePath || r.to === filePath) && (!type || r.type === type),
    );
    return { relations: filtered.slice(0, limit ?? 20) };
  },
});
