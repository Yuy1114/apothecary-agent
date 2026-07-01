import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createId } from "../utils/ids.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export const proposeEditTool = createTool({
  id: "proposeEdit",
  description:
    "Propose an edit to a vault file. The edit will be saved as a proposal for human review — it will NOT be applied automatically. " +
    "Describe what you want to change and why. The proposal includes the file path, the change description, and the suggested content.",
  inputSchema: z.object({
    filePath: z.string().describe("Relative path to the file to edit"),
    title: z.string().describe("Short title for the edit proposal"),
    description: z.string().describe("What you want to change and why"),
    suggestedContent: z.string().optional().describe("The suggested new content for the file (full or partial)"),
  }),
  outputSchema: z.object({
    proposalId: z.string(),
    filePath: z.string(),
    title: z.string(),
    savedTo: z.string(),
  }),
  execute: async ({ filePath, title, description, suggestedContent }) => {
    const proposalId = `edit-${createId("proposal")}`;
    const editsDir = path.join(VAULT_PATH, ".agent", "edits");
    await fs.mkdir(editsDir, { recursive: true });

    // Read current content
    const absolutePath = path.join(VAULT_PATH, filePath);
    let currentContent = "";
    try {
      currentContent = await fs.readFile(absolutePath, "utf8");
    } catch {
      currentContent = "(new file)";
    }

    // Write proposal
    const proposalPath = path.join(editsDir, `${proposalId}.json`);
    await fs.writeFile(
      proposalPath,
      JSON.stringify(
        {
          id: proposalId,
          filePath,
          title,
          description,
          currentContent: currentContent.slice(0, 5000),
          suggestedContent: suggestedContent ?? "",
          status: "proposed",
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    return { proposalId, filePath, title, savedTo: `.agent/edits/${proposalId}.json` };
  },
});
