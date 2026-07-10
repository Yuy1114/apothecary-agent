import type { SearchIndexPort } from "../../application/ports/searchIndex.js";
import { reindexFile, removeFromIndex, queryVault } from "../tools/rag.js";

/**
 * Binds the application's SearchIndexPort to the real Mastra/LibSQL vector
 * index. Installed by installPorts(), which seeds rag.ts's vector store in the
 * same call — without it these delegates cannot answer.
 */
export const ragSearchIndex: SearchIndexPort = {
  reindexFile,
  removeFromIndex,
  queryVault,
};
