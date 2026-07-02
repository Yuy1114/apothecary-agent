import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { updateDirectoryKeywords } from "./vault-structure.js";
import { requiresHumanApproval } from "./permissions.js";

export const updateStructureKeywordsTool = createTool({
  id: "updateStructureKeywords",
  description:
    "Propose adding or removing classification keywords for an EXISTING directory in .agent/structure.yaml. " +
    "Use this when content clearly belongs to a directory but its keywords did not catch it, so future " +
    "auto-classification improves. This changes how all future content is classified and requires human approval. " +
    "It only edits keywords — it does not create/move directories or change aliases. " +
    "Any added keyword that already belongs to another directory is returned in `conflicts` as a warning.",
  requireApproval: requiresHumanApproval,
  inputSchema: z.object({
    directory: z
      .string()
      .describe("Exact directory key from readStructure, e.g. 'reflections/' (with trailing slash)"),
    add: z.array(z.string()).optional().describe("Keywords to add"),
    remove: z.array(z.string()).optional().describe("Keywords to remove"),
  }),
  outputSchema: z.object({
    directory: z.string(),
    keywords: z.array(z.string()),
    conflicts: z.array(z.string()),
  }),
  execute: async ({ directory, add, remove }) => updateDirectoryKeywords({ directory, add, remove }),
});
