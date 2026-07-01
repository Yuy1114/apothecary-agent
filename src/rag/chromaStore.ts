import { promises as fs } from "node:fs";
import path from "node:path";
import { MDocument } from "@mastra/rag";
import { embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";
const INDEX_PATH = path.join(VAULT_PATH, ".agent", "rag-index.json");

type IndexedChunk = {
  source: string;
  content: string;
  title?: string;
  headings?: string[];
  embedding: number[];
};

let index: IndexedChunk[] | null = null;

function getEmbeddingProvider() {
  return createOpenAI({
    baseURL: process.env.APOTHECARY_EMBEDDING_BASE_URL ?? "https://aihubmix.com/v1",
    apiKey: process.env.APOTHECARY_EMBEDDING_API_KEY ?? "",
  });
}

async function loadIndex(): Promise<IndexedChunk[]> {
  if (index) return index;
  try {
    const raw = await fs.readFile(INDEX_PATH, "utf8");
    index = JSON.parse(raw);
    return index!;
  } catch {
    return [];
  }
}

export async function indexVault(scopePath?: string): Promise<{ indexed: number }> {
  const scanRoot = scopePath ? path.join(VAULT_PATH, scopePath) : VAULT_PATH;
  const files = await walkMarkdownFiles(scanRoot);
  const chunks: Array<{ source: string; content: string; title?: string; headings?: string[] }> = [];

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    const relativePath = path.relative(VAULT_PATH, file);
    const title = extractTitle(content, relativePath);
    const headings = extractHeadingTree(content);

    const doc = MDocument.fromMarkdown(content, { type: "md" });
    const docChunks = await doc.chunk({ strategy: "markdown", maxSize: 800, overlap: 60 });

    for (let ci = 0; ci < docChunks.length; ci++) {
      const chunk = docChunks[ci];
      if (chunk.text.trim().length < 50) continue;

      // Find which heading section this chunk belongs to
      const chunkStart = findChunkPosition(content, docChunks, ci);
      const breadcrumb = findHeadingBreadcrumb(headings, chunkStart);

      chunks.push({
        source: relativePath,
        content: chunk.text.slice(0, 2000),
        title,
        headings: breadcrumb.length > 0 ? breadcrumb : undefined,
      });
    }
  }

  const embeddingModel = getEmbeddingProvider().embedding(
    process.env.APOTHECARY_EMBEDDING_MODEL ?? "text-embedding-3-small",
  );
  const batchSize = 50;
  const indexed: IndexedChunk[] = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const { embeddings } = await embedMany({ model: embeddingModel, values: batch.map((c) => c.content) });

    for (let j = 0; j < batch.length; j++) {
      indexed.push({
        source: batch[j].source,
        content: batch[j].content,
        title: batch[j].title,
        headings: batch[j].headings,
        embedding: embeddings[j] as unknown as number[],
      });
    }
  }

  await fs.mkdir(path.dirname(INDEX_PATH), { recursive: true });
  await fs.writeFile(INDEX_PATH, JSON.stringify(indexed), "utf8");
  index = indexed;

  return { indexed: indexed.length };
}

export async function reindexFile(relativePath: string): Promise<{ added: number }> {
  const absolutePath = path.join(VAULT_PATH, relativePath);
  const content = await fs.readFile(absolutePath, "utf8");
  const title = extractTitle(content, relativePath);
  const headings = extractHeadingTree(content);

  const doc = MDocument.fromMarkdown(content, { type: "md" });
  const docChunks = await doc.chunk({ strategy: "markdown", maxSize: 800, overlap: 60 });
  const newChunks: Array<{ source: string; content: string; title?: string; headings?: string[] }> = [];

  for (let ci = 0; ci < docChunks.length; ci++) {
    if (docChunks[ci].text.trim().length < 50) continue;
    const chunkStart = findChunkPosition(content, docChunks, ci);
    newChunks.push({
      source: relativePath,
      content: docChunks[ci].text.slice(0, 2000),
      title,
      headings: findHeadingBreadcrumb(headings, chunkStart),
    });
  }

  if (newChunks.length === 0) return { added: 0 };

  const existing = await loadIndex().then((idx) => idx.filter((c) => c.source !== relativePath));
  const embeddingModel = getEmbeddingProvider().embedding(
    process.env.APOTHECARY_EMBEDDING_MODEL ?? "text-embedding-3-small",
  );
  const { embeddings } = await embedMany({ model: embeddingModel, values: newChunks.map((c) => c.content) });

  for (let j = 0; j < newChunks.length; j++) {
    existing.push({
      source: newChunks[j].source,
      content: newChunks[j].content,
      title: newChunks[j].title,
      headings: newChunks[j].headings,
      embedding: embeddings[j] as unknown as number[],
    });
  }

  await fs.writeFile(INDEX_PATH, JSON.stringify(existing), "utf8");
  index = existing;
  return { added: newChunks.length };
}

export async function queryVault(query: string, topK = 5): Promise<Array<{ source: string; content: string; title?: string; headings?: string[] }>> {
  const chunks = await loadIndex();
  if (chunks.length === 0) return [];

  const embeddingModel = getEmbeddingProvider().embedding(
    process.env.APOTHECARY_EMBEDDING_MODEL ?? "text-embedding-3-small",
  );
  const { embedding } = await import("ai").then(({ embed }) =>
    embed({ model: embeddingModel, value: query }),
  );

  const queryVec = embedding as unknown as number[];
  const scored = chunks.map((chunk, idx) => ({ idx, score: cosineSimilarity(queryVec, chunk.embedding) }));

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => ({
      source: chunks[s.idx].source,
      title: chunks[s.idx].title,
      headings: chunks[s.idx].headings,
      content: chunks[s.idx].content.slice(0, 1000),
    }));
}

// ── Heading tree extraction ──

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
    pos += line.length + 1; // +1 for \n
  }
  return nodes;
}

function findChunkPosition(content: string, chunks: Array<{ text: string }>, chunkIdx: number): number {
  let pos = 0;
  for (let i = 0; i < chunkIdx; i++) {
    const idx = content.indexOf(chunks[i].text, pos);
    if (idx >= 0) pos = idx + chunks[i].text.length;
  }
  const idx = content.indexOf(chunks[chunkIdx].text, pos);
  return idx >= 0 ? idx : pos;
}

function findHeadingBreadcrumb(headings: HeadingNode[], chunkPosition: number): string[] {
  const breadcrumb: string[] = [];
  for (const h of headings) {
    if (h.position > chunkPosition) break;
    // Keep only the deepest heading at each level
    while (breadcrumb.length >= h.level) breadcrumb.pop();
    breadcrumb.push(h.text);
  }
  return breadcrumb;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function extractTitle(content: string, filePath: string): string {
  const match = content.match(/^#\s+(.+)/m);
  return match ? match[1] : path.basename(filePath, ".md");
}

async function walkMarkdownFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await walkMarkdownFiles(p)));
    else if (entry.name.endsWith(".md")) files.push(p);
  }
  return files;
}
