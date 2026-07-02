import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { EditProposalSchema } from "../../domain/applyProposal.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

const ProposalStatusSchema = z.enum(["proposed", "applied", "rejected"]);

export const listProposalsTool = createTool({
  id: "listProposals",
  description:
    "List edit proposals stored under .agent/edits, most recent first. " +
    "Use this to see which proposals are pending (status 'proposed') before applying them with applyEdit. " +
    "Returns lightweight metadata only — not the full suggested content.",
  inputSchema: z.object({
    status: ProposalStatusSchema.optional().describe("Filter by proposal status"),
  }),
  outputSchema: z.object({
    proposals: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        filePath: z.string(),
        status: z.string(),
        createdAt: z.string(),
      }),
    ),
  }),
  execute: async ({ status }) => {
    const editsDir = path.join(VAULT_PATH, ".agent", "edits");

    let entries: string[];
    try {
      entries = (await fs.readdir(editsDir)).filter((name) => name.endsWith(".json"));
    } catch {
      return { proposals: [] };
    }

    const proposals = [];
    for (const name of entries) {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(editsDir, name), "utf8"));
        const proposal = EditProposalSchema.parse(raw);
        if (status && proposal.status !== status) continue;
        proposals.push({
          id: proposal.id,
          title: proposal.title,
          filePath: proposal.filePath,
          status: proposal.status,
          createdAt: proposal.createdAt,
        });
      } catch {
        // Skip malformed proposal files.
      }
    }

    proposals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { proposals };
  },
});
