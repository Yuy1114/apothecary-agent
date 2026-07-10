/**
 * The vault's vector search index, as the application layer needs it.
 *
 * The concrete index is Mastra + LibSQL + a remote embedding endpoint (see
 * mastra/tools/rag.ts). Use cases must not depend on any of that: they only
 * need to keep the index in step with the files they touch, and to query it.
 *
 * The implementation is installed once at a composition root (mastra/index.ts
 * for Studio, desktop/runtime.ts for the app) alongside setVectorStore().
 * Tests install a fake instead — no module-graph mocking required.
 */

export type SearchHit = {
  source: string;
  content: string;
  title?: string;
  headings?: string[];
  /** Set when the source note has a `superseded_by` frontmatter link. */
  supersededBy?: string;
};

export interface SearchIndexPort {
  /** Re-chunk and re-embed one vault-relative file, replacing its old chunks. */
  reindexFile(relativePath: string): Promise<{ added: number }>;
  /** Drop every chunk belonging to one vault-relative file. */
  removeFromIndex(relativePath: string): Promise<{ removed: number }>;
  /** Nearest-neighbour lookup over indexed chunks. */
  queryVault(query: string, topK?: number): Promise<SearchHit[]>;
}

let installed: SearchIndexPort | null = null;

export function setSearchIndex(next: SearchIndexPort): void {
  installed = next;
}

export function searchIndex(): SearchIndexPort {
  if (!installed) {
    throw new Error(
      "Search index not installed. Call setSearchIndex() at the composition root.",
    );
  }
  return installed;
}

/**
 * A search index that accepts every write and finds nothing. For tests and
 * flows where indexing is out of scope; never install this in production.
 */
export const nullSearchIndex: SearchIndexPort = {
  async reindexFile() {
    return { added: 0 };
  },
  async removeFromIndex() {
    return { removed: 0 };
  },
  async queryVault() {
    return [];
  },
};
