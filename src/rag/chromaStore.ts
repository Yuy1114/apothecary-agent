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
  const chunks: Array<{ source: string; content: string; title?: string }> = [];

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    const relativePath = path.relative(VAULT_PATH, file);
    const title = extractTitle(content, relativePath);

    // Use Mastra RAG for smart markdown chunking
    const doc = MDocument.fromMarkdown(content, { type: "md" });
    const docChunks = await doc.chunk({
      strategy: "markdown",
      maxSize: 800,
      overlap: 60,
    });

    for (const chunk of docChunks) {
      if (chunk.text.trim().length < 50) continue;
      chunks.push({ source: relativePath, content: chunk.text.slice(0, 2000), title });
    }
  }

  // Generate embeddings in batches
  const embeddingModel = getEmbeddingProvider().embedding(
    process.env.APOTHECARY_EMBEDDING_MODEL ?? "text-embedding-3-small",
  );

  const batchSize = 50;
  const indexed: IndexedChunk[] = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const { embeddings } = await embedMany({
      model: embeddingModel,
      values: batch.map((c) => c.content),
    });

    for (let j = 0; j < batch.length; j++) {
      indexed.push({
        source: batch[j].source,
        content: batch[j].content,
        title: batch[j].title,
        embedding: embeddings[j] as unknown as number[],
      });
    }
  }

  await fs.mkdir(path.dirname(INDEX_PATH), { recursive: true });
  await fs.writeFile(INDEX_PATH, JSON.stringify(indexed), "utf8");
  index = indexed;

  return { indexed: indexed.length };
}

/**
 * Re-index a single file (called after ingest). Appends its chunks to the existing index.
 */
export async function reindexFile(relativePath: string): Promise<{ added: number }> {
  const absolutePath = path.join(VAULT_PATH, relativePath);
  const content = await fs.readFile(absolutePath, "utf8");
  const title = extractTitle(content, relativePath);

  const doc = MDocument.fromMarkdown(content, { type: "md" });
  const docChunks = await doc.chunk({ strategy: "markdown", maxSize: 800, overlap: 60 });

  const newChunks: Array<{ source: string; content: string; title?: string }> = [];
  for (const chunk of docChunks) {
    if (chunk.text.trim().length < 50) continue;
    newChunks.push({ source: relativePath, content: chunk.text.slice(0, 2000), title });
  }

  if (newChunks.length === 0) return { added: 0 };

  // Load existing index, remove old chunks for this file, append new ones
  const existing = await loadIndex().then((idx) => idx.filter((c) => c.source !== relativePath));

  const embeddingModel = getEmbeddingProvider().embedding(
    process.env.APOTHECARY_EMBEDDING_MODEL ?? "text-embedding-3-small",
  );
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: newChunks.map((c) => c.content),
  });

  for (let j = 0; j < newChunks.length; j++) {
    existing.push({
      source: newChunks[j].source,
      content: newChunks[j].content,
      title: newChunks[j].title,
      embedding: embeddings[j] as unknown as number[],
    });
  }

  await fs.writeFile(INDEX_PATH, JSON.stringify(existing), "utf8");
  index = existing;

  return { added: newChunks.length };
}

export async function queryVault(query: string, topK = 5): Promise<Array<{ source: string; content: string; title?: string }>> {
  const chunks = await loadIndex();
  if (chunks.length === 0) return [];

  // Generate query embedding
  const embeddingModel = getEmbeddingProvider().embedding(
    process.env.APOTHECARY_EMBEDDING_MODEL ?? "text-embedding-3-small",
  );
  const { embedding } = await import("ai").then(({ embed }) =>
    embed({ model: embeddingModel, value: query }),
  );

  // Cosine similarity
  const queryVec = embedding as unknown as number[];
  const scored = chunks.map((chunk, idx) => ({
    idx,
    score: cosineSimilarity(queryVec, chunk.embedding),
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => ({
      source: chunks[s.idx].source,
      title: chunks[s.idx].title,
      content: chunks[s.idx].content.slice(0, 1000),
    }));
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function extractTitle(content: string, filePath: string): string {
  const headingMatch = content.match(/^#\s+(.+)/m);
  if (headingMatch) return headingMatch[1];
  return path.basename(filePath, ".md");
}

async function walkMarkdownFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdownFiles(fullPath)));
    } else if (entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}
