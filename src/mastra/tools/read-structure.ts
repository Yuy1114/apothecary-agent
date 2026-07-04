import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { loadStructure } from "./vault-structure.js";

export const readStructureTool = createTool({
  id: "readStructure",
  description:
    "Read the vault's directory layout from the agent's structure config. Each directory has a description and optional keywords. " +
    "Use this before classifying or moving files so placement follows the configured structure.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    directories: z.array(
      z.object({
        path: z.string(),
        description: z.string(),
        keywords: z.array(z.string()),
      }),
    ),
  }),
  execute: async () => {
    const structure = await loadStructure();
    const directories = Object.entries(structure.directories).map(([dirPath, def]) => ({
      path: dirPath,
      description: def.description ?? "",
      keywords: def.keywords ?? [],
    }));
    return { directories };
  },
});
