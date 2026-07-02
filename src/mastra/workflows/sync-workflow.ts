import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { indexVault, reindexFile, removeFromIndex } from "../tools/rag.js";

const indexStep = createStep({
  id: "index-vault",
  inputSchema: z.object({}),
  outputSchema: z.object({ indexed: z.number() }),
  execute: async () => {
    const result = await indexVault();
    return { indexed: result.indexed };
  },
});

const reindexFileStep = createStep({
  id: "reindex-file",
  inputSchema: z.object({ filePath: z.string() }),
  outputSchema: z.object({ added: z.number() }),
  execute: async ({ inputData }) => {
    const result = await reindexFile(inputData.filePath);
    return { added: result.added };
  },
});

const removeFileStep = createStep({
  id: "remove-from-index",
  inputSchema: z.object({ filePath: z.string() }),
  outputSchema: z.object({ removed: z.number() }),
  execute: async ({ inputData }) => {
    const result = await removeFromIndex(inputData.filePath);
    return { removed: result.removed };
  },
});

export const fullReindexWorkflow = createWorkflow({
  id: "full-reindex",
  inputSchema: z.object({}),
  outputSchema: z.object({ indexed: z.number() }),
})
  .then(indexStep)
  .commit();

export const fileChangedWorkflow = createWorkflow({
  id: "file-changed",
  inputSchema: z.object({ filePath: z.string() }),
  outputSchema: z.object({ added: z.number() }),
})
  .then(reindexFileStep)
  .commit();

export const fileDeletedWorkflow = createWorkflow({
  id: "file-deleted",
  inputSchema: z.object({ filePath: z.string() }),
  outputSchema: z.object({ removed: z.number() }),
})
  .then(removeFileStep)
  .commit();
