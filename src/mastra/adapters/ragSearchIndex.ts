import type { SearchIndexPort } from "../../application/ports/searchIndex.js";
import { reindexFile, removeFromIndex, queryVault } from "../tools/rag.js";

/**
 * Binds the application's SearchIndexPort to the real Mastra/LibSQL vector
 * index. Install at a composition root, after setVectorStore().
 */
export const ragSearchIndex: SearchIndexPort = {
  reindexFile,
  removeFromIndex,
  queryVault,
};
