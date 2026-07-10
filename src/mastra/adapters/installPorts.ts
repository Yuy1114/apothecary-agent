import type { LibSQLVector } from "@mastra/libsql";
import { setVectorStore } from "../tools/rag.js";
import { ragSearchIndex } from "./ragSearchIndex.js";
import { generateFileSummary } from "./mastraFileSummarizer.js";
import { setSearchIndex } from "../../application/ports/searchIndex.js";
import { setFileSummarizer } from "../../application/ports/fileSummarizer.js";

/**
 * Bind every registry-injected port to its Mastra implementation.
 *
 * Call once per process at a composition root — `mastra/index.ts` for Studio,
 * `desktop/runtime.ts` for Electron — before anything drives a use case. The
 * ports throw rather than no-op when unset, so a root that skips this fails on
 * the first indexed write instead of quietly corrupting the index.
 *
 * The vector store is seeded here too: `ragSearchIndex` delegates to `rag.ts`,
 * which cannot answer a query without it. The two are one decision, not two.
 *
 * Ports that are injected explicitly (`KnowledgeViewWriter`, `ReviewerModel`)
 * are handed over at their call sites and do not belong here. See
 * `docs/architecture.md`.
 */
export function installPorts(vectorStore: LibSQLVector): void {
  setVectorStore(vectorStore);
  setSearchIndex(ragSearchIndex);
  setFileSummarizer(generateFileSummary);
}
