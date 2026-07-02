import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { requiresHumanApproval } from "./permissions.js";
import { writeVaultNote } from "./ingest-core.js";

export const ingestVaultTool = createTool({
  id: "ingestVault",
  description:
    "Ingest new content into the vault. Classifies content using the vault structure config (.agent/structure.yaml), creates a file in the right directory, updates README, and auto-indexes for search.",
  requireApproval: requiresHumanApproval,
  inputSchema: z.object({
    content: z.string().describe("The full content to ingest."),
    title: z.string().optional().describe("Suggested title."),
    topic: z.string().optional().describe("Hint: directory path like 'notes/programming/Redis' or description match."),
  }),
  outputSchema: z.object({
    filePath: z.string(),
    topic: z.string(),
    title: z.string(),
    readmeUpdated: z.boolean(),
  }),
  execute: async ({ content, title, topic }) =>
    writeVaultNote({ content, title, topic, noteType: "note", source: "ingestVault", operationType: "ingest" }),
});
