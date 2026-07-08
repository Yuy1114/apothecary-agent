import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { embed, embedMany } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LibSQLVector } from "@mastra/libsql";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createVectorQueryTool, MDocument } from "@mastra/rag";
import { getFrontmatterKey } from "../../vault/frontmatter.js";
import { logger, startTimer } from "../../observability/logger.js";

// ── Embedding model ──

const embeddingProvider = createOpenAICompatible({
  name: "aihubmix",
  baseURL:
    process.env.APOTHECARY_EMBEDDING_BASE_URL ?? "https://api.aihubmix.com/v1",
  apiKey:
    process.env.APOTHECARY_EMBEDDING_API_KEY ??
    process.env.OPENAI_API_KEY ??
    "",
});

export const embedder = embeddingProvider.embeddingModel(
  process.env.APOTHECARY_EMBEDDING_MODEL ?? "text-embedding-3-small"
);
export const EMBEDDING_MODEL = embedder;

// Bound every embedding round-trip so an unreachable or slow embedding endpoint
// can never hang a file operation (e.g. the reindex during _inbox intake, which
// otherwise freezes the whole agent run). On timeout the call throws, which the
// callers treat as a best-effort index miss rather than a failure.
const EMBEDDING_TIMEOUT_MS = Number(process.env.APOTHECARY_EMBEDDING_TIMEOUT_MS ?? 20_000);

// ── Constants ──

const INDEX_NAME = "vault_chunks";
const VECTOR_STORE_NAME = "vaultChunks";
const VAULT_PATH =
  process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

// ── Vector store singleton ──

let store: LibSQLVector | null = null;

export function setVectorStore(vs: LibSQLVector): void {
  store = vs;
}

function getVectorStore(): LibSQLVector {
  if (!store)
    throw new Error(
      "Vector store not initialized. Call setVectorStore() first."
    );
  return store;
}

// ── Types ──

type ChunkDraft = {
  id: string;
  source: string;
  content: string;
  title?: string;
  headings?: string[];
  chunkIndex: number;
  contentHash: string;
};

type SearchResult = {
  source: string;
  content: string;
  title?: string;
  headings?: string[];
  /** Set when the source note has a `superseded_by` frontmatter link. */
  supersededBy?: string;
};

/**
 * Stable canonical-aware re-rank: keep vector order but push notes that have
 * been superseded (retired in favour of a canonical note) to the end, so
 * current content outranks stale content without dropping it entirely.
 */
export function demoteSuperseded<T extends { supersededBy?: string }>(results: T[]): T[] {
  return [
    ...results.filter((result) => !result.supersededBy),
    ...results.filter((result) => result.supersededBy),
  ];
}

// ── Plain functions (for workflows and processors) ──

export async function indexVault(
  scopePath?: string
): Promise<{ indexed: number }> {
  const scanRoot = scopePath ? path.join(VAULT_PATH, scopePath) : VAULT_PATH;
  const files = await walkMarkdownFiles(scanRoot);
  const chunks: ChunkDraft[] = [];

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    const relativePath = toPortablePath(path.relative(VAULT_PATH, file));
    chunks.push(...(await buildChunkDrafts(relativePath, content)));
  }

  if (chunks.length === 0) {
    await ensureIndex();
    return { indexed: 0 };
  }

  const embeddings = await embedChunks(chunks);
  const vs = getVectorStore();

  try {
    await vs.deleteIndex({ indexName: INDEX_NAME });
  } catch {
    /* not found */
  }

  await vs.createIndex({
    indexName: INDEX_NAME,
    dimension: embeddings[0].length,
    metric: "cosine",
  });

  await vs.upsert({
    indexName: INDEX_NAME,
    vectors: embeddings,
    metadata: chunks.map(toMetadata),
    ids: chunks.map((c) => c.id),
  });

  return { indexed: chunks.length };
}

export async function reindexFile(
  relativePath: string
): Promise<{ added: number }> {
  const normalizedPath = toPortablePath(relativePath);
  const absolutePath = path.join(VAULT_PATH, normalizedPath);
  const content = await fs.readFile(absolutePath, "utf8");
  const chunks = await buildChunkDrafts(normalizedPath, content);

  if (chunks.length === 0) {
    await deleteSourceChunks(normalizedPath);
    return { added: 0 };
  }

  await ensureIndex();
  // Log a start line BEFORE the network-bound embedding call so a slow/stuck
  // endpoint is visible as "started, never finished" (the completion line only
  // prints on success; the call is bounded by EMBEDDING_TIMEOUT_MS).
  logger.info("rag", `reindex ${normalizedPath} · embedding ${chunks.length} chunks…`);
  const done = startTimer("rag", `reindex ${normalizedPath} done`);
  const embeddings = await embedChunks(chunks);
  done();
  const vs = getVectorStore();

  await vs.upsert({
    indexName: INDEX_NAME,
    vectors: embeddings,
    metadata: chunks.map(toMetadata),
    ids: chunks.map((c) => c.id),
    deleteFilter: { source: normalizedPath } as any,
  });

  return { added: chunks.length };
}

export async function removeFromIndex(
  relativePath: string
): Promise<{ removed: number }> {
  await deleteSourceChunks(toPortablePath(relativePath));
  return { removed: -1 };
}

export async function queryVault(
  query: string,
  topK = 5
): Promise<SearchResult[]> {
  const cleanedQuery = query.trim();
  if (!cleanedQuery) return [];

  await ensureIndexSilent();
  const vs = getVectorStore();

  try {
    const { embedding } = await embed({
      model: EMBEDDING_MODEL,
      value: cleanedQuery,
      abortSignal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    });
    const results = await vs.query({
      indexName: INDEX_NAME,
      queryVector: embedding as unknown as number[],
      topK,
    });

    const mapped = results
      .map((result): SearchResult | null => {
        const meta = result.metadata;
        if (!meta?.source) return null;
        return {
          source: meta.source as string,
          title: (meta.title as string) || undefined,
          headings: parseHeadings(meta.headingsJson),
          content: (meta.content as string)?.slice(0, 1000) ?? "",
        };
      })
      .filter((item): item is SearchResult => item !== null);

    // Canonical-aware: flag results whose note was superseded, then demote them
    // so the answer prefers the current/canonical content.
    const enriched = await Promise.all(mapped.map((result) => withSupersededBy(result)));
    return demoteSuperseded(enriched);
  } catch {
    return [];
  }
}

/** Attach `supersededBy` by reading the source note's frontmatter (best-effort). */
async function withSupersededBy(result: SearchResult): Promise<SearchResult> {
  try {
    const content = await fs.readFile(path.join(VAULT_PATH, result.source), "utf8");
    const supersededBy = getFrontmatterKey(content, "superseded_by");
    if (typeof supersededBy === "string" && supersededBy.trim()) {
      return { ...result, supersededBy };
    }
  } catch {
    // Unreadable note → treat as not superseded.
  }
  return result;
}

// ── Mastra tools (for agents) ──

export const queryVaultTool = createVectorQueryTool({
  id: "queryVault",
  description:
    "Search Yuy's vault for relevant markdown excerpts using semantic search. Use this when answering questions that need evidence from the vault. Cite source metadata paths in the answer.",
  vectorStoreName: VECTOR_STORE_NAME,
  indexName: INDEX_NAME,
  model: EMBEDDING_MODEL as any,
  includeSources: true,
});

export const indexVaultTool = createTool({
  id: "indexVault",
  description:
    "Rebuild the vault search index. Use when content is not found or after bulk imports.",
  inputSchema: z.object({
    scopePath: z
      .string()
      .optional()
      .describe("Limit indexing to a subdirectory."),
  }),
  outputSchema: z.object({ indexed: z.number() }),
  execute: async ({ scopePath }) => indexVault(scopePath),
});

// ── Internal: chunking ──

async function buildChunkDrafts(
  relativePath: string,
  content: string
): Promise<ChunkDraft[]> {
  const title = extractTitle(content, relativePath);
  const headings = extractHeadingTree(content);
  const doc = MDocument.fromMarkdown(content, { type: "md" });
  const docChunks = await doc.chunk({
    strategy: "markdown",
    maxSize: 800,
    overlap: 60,
  });

  const chunks: ChunkDraft[] = [];
  for (let chunkIndex = 0; chunkIndex < docChunks.length; chunkIndex++) {
    const chunk = docChunks[chunkIndex];
    const text = chunk.text.trim();
    if (text.length < 50) continue;

    const chunkStart = findChunkPosition(content, docChunks, chunkIndex);
    const breadcrumb = findHeadingBreadcrumb(headings, chunkStart);
    const contentHash = hashText(text);

    chunks.push({
      id: createChunkId(relativePath, chunkIndex, contentHash),
      source: relativePath,
      content: text.slice(0, 2000),
      title,
      headings: breadcrumb.length > 0 ? breadcrumb : undefined,
      chunkIndex,
      contentHash,
    });
  }
  return chunks;
}

async function embedChunks(chunks: ChunkDraft[]): Promise<number[][]> {
  if (chunks.length === 0) return [];
  const embeddings: number[][] = [];
  const batchSize = 50;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const result = await embedMany({
      model: EMBEDDING_MODEL,
      values: batch.map((c) => c.content),
      abortSignal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    });
    embeddings.push(...(result.embeddings as unknown as number[][]));
  }
  return embeddings;
}

function toMetadata(chunk: ChunkDraft): Record<string, unknown> {
  return {
    source: chunk.source,
    title: chunk.title ?? null,
    headingsJson: JSON.stringify(chunk.headings ?? []),
    content: chunk.content,
    chunkIndex: chunk.chunkIndex,
    contentHash: chunk.contentHash,
    indexedAt: new Date().toISOString(),
  };
}

// ── Internal: index management ──

async function ensureIndex(): Promise<void> {
  const vs = getVectorStore();
  const indexes = await vs.listIndexes();
  if (indexes.includes(INDEX_NAME)) return;
  await vs.createIndex({
    indexName: INDEX_NAME,
    dimension: 1536,
    metric: "cosine",
  });
}

async function ensureIndexSilent(): Promise<void> {
  try {
    await ensureIndex();
  } catch {
    /* ignore */
  }
}

async function deleteSourceChunks(relativePath: string): Promise<void> {
  try {
    const vs = getVectorStore();
    await vs.deleteVectors({
      indexName: INDEX_NAME,
      filter: { source: relativePath } as any,
    });
  } catch {
    /* ignore */
  }
}

// ── Helpers ──

function createChunkId(
  relativePath: string,
  chunkIndex: number,
  contentHash: string
): string {
  return hashText(`${relativePath}:${chunkIndex}:${contentHash}`);
}

function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function toPortablePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function parseHeadings(rawValue: unknown): string[] | undefined {
  if (typeof rawValue !== "string") return undefined;
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

type HeadingNode = { level: number; text: string; position: number };

function extractHeadingTree(content: string): HeadingNode[] {
  const lines = content.split("\n");
  const nodes: HeadingNode[] = [];
  let pos = 0;
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      nodes.push({
        level: match[1].length,
        text: match[2].trim(),
        position: pos,
      });
    }
    pos += line.length + 1;
  }
  return nodes;
}

function findChunkPosition(
  content: string,
  chunks: Array<{ text: string }>,
  chunkIdx: number
): number {
  let pos = 0;
  for (let i = 0; i < chunkIdx; i++) {
    const idx = content.indexOf(chunks[i].text, pos);
    if (idx >= 0) pos = idx + chunks[i].text.length;
  }
  return pos;
}

function findHeadingBreadcrumb(
  headings: HeadingNode[],
  chunkPosition: number
): string[] {
  const breadcrumb: string[] = [];
  for (const heading of headings) {
    if (heading.position > chunkPosition) break;
    while (breadcrumb.length >= heading.level) breadcrumb.pop();
    breadcrumb.push(heading.text);
  }
  return breadcrumb;
}

function extractTitle(content: string, filePath: string): string {
  const match = content.match(/^#\s+(.+)/m);
  return match ? match[1] : path.basename(filePath, ".md");
}

async function walkMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walkMarkdownFiles(full)));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(full);
      }
    }
  } catch {
    /* ignore */
  }
  return files;
}
