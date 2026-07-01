import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { MDocument } from "@mastra/rag";
import { embed, embedMany } from "ai";
import { LibSQLVector } from "@mastra/libsql";
import { getEmbeddingModel } from "../mastra/embedding.js";

const INDEX_NAME = "vault_chunks";
const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

// ── Vector store (injected by Mastra setup) ──

let store: LibSQLVector | null = null;

export function setVectorStore(vs: LibSQLVector): void {
  store = vs;
}

function getVectorStore(): LibSQLVector {
  if (!store) throw new Error("Vector store not initialized. Call setVectorStore() first.");
  return store;
}

// ── Vector store (injected by Mastra setup) ──

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
};

// ── Public API ──

export async function indexVault(scopePath?: string): Promise<{ indexed: number }> {
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

  // Drop and recreate for full reindex
  try { await vs.deleteIndex({ indexName: INDEX_NAME }); } catch { /* not found */ }

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

export async function reindexFile(relativePath: string): Promise<{ added: number }> {
  const normalizedPath = toPortablePath(relativePath);
  const absolutePath = path.join(VAULT_PATH, normalizedPath);
  const content = await fs.readFile(absolutePath, "utf8");
  const chunks = await buildChunkDrafts(normalizedPath, content);

  if (chunks.length === 0) {
    await deleteSourceChunks(normalizedPath);
    return { added: 0 };
  }

  await ensureIndex();
  const embeddings = await embedChunks(chunks);
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

export async function removeFromIndex(relativePath: string): Promise<{ removed: number }> {
  await deleteSourceChunks(toPortablePath(relativePath));
  return { removed: -1 }; // LibSQLVector deleteVectors doesn't return count
}

export async function queryVault(query: string, topK = 5): Promise<SearchResult[]> {
  const cleanedQuery = query.trim();
  if (!cleanedQuery) return [];

  await ensureIndexSilent();
  const vs = getVectorStore();

  try {
    const { embedding } = await embed({ model: getEmbeddingModel(), value: cleanedQuery });
    const results = await vs.query({
      indexName: INDEX_NAME,
      queryVector: embedding as unknown as number[],
      topK,
    });

    return results
      .map((r): SearchResult | null => {
        const meta = r.metadata;
        if (!meta?.source) return null;
        return {
          source: meta.source as string,
          title: (meta.title as string) || undefined,
          headings: parseHeadings(meta.headingsJson),
          content: (meta.content as string)?.slice(0, 1000) ?? "",
        };
      })
      .filter((item): item is SearchResult => item !== null);
  } catch {
    return [];
  }
}

// ── Internal: chunking ──

async function buildChunkDrafts(relativePath: string, content: string): Promise<ChunkDraft[]> {
  const title = extractTitle(content, relativePath);
  const headings = extractHeadingTree(content);
  const doc = MDocument.fromMarkdown(content, { type: "md" });
  const docChunks = await doc.chunk({ strategy: "markdown", maxSize: 800, overlap: 60 });

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
    const result = await embedMany({ model: getEmbeddingModel(), values: batch.map((c) => c.content) });
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

  // Create with default dimension (1536 for text-embedding-3-small)
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
    // Index may not exist yet
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
    // Index or vectors may not exist
  }
}

// ── Helpers ──

function createChunkId(relativePath: string, chunkIndex: number, contentHash: string): string {
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
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
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
      nodes.push({ level: match[1].length, text: match[2].trim(), position: pos });
    }
    pos += line.length + 1;
  }
  return nodes;
}

function findChunkPosition(content: string, chunks: Array<{ text: string }>, chunkIdx: number): number {
  let pos = 0;
  for (let i = 0; i < chunkIdx; i++) {
    const idx = content.indexOf(chunks[i].text, pos);
    if (idx >= 0) pos = idx + chunks[i].text.length;
  }
  return pos;
}

function findHeadingBreadcrumb(headings: HeadingNode[], chunkPosition: number): string[] {
  const breadcrumb: string[] = [];
  for (const h of headings) {
    if (h.position > chunkPosition) break;
    while (breadcrumb.length >= h.level) breadcrumb.pop();
    breadcrumb.push(h.text);
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
    // Directory may not exist
  }
  return files;
}
