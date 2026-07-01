import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { MDocument } from "@mastra/rag";
import { embed, embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { ChromaClient, type Collection, type Metadata } from "chromadb";

const CHROMA_COLLECTION = "vault_chunks";
const CHROMA_HOST = process.env.APOTHECARY_CHROMA_HOST ?? "localhost";
const CHROMA_PORT = Number(process.env.APOTHECARY_CHROMA_PORT ?? "8000");

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

let collectionPromise: Promise<Collection> | null = null;

function getEmbeddingProvider() {
  return createOpenAI({
    baseURL: process.env.APOTHECARY_EMBEDDING_BASE_URL ?? "https://aihubmix.com/v1",
    apiKey: process.env.APOTHECARY_EMBEDDING_API_KEY ?? "",
  });
}

function getEmbeddingModel() {
  return getEmbeddingProvider().embedding(
    process.env.APOTHECARY_EMBEDDING_MODEL ?? "text-embedding-3-small",
  );
}

function getChromaClient(): ChromaClient {
  return new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT });
}

async function getCollection(): Promise<Collection> {
  collectionPromise ??= getChromaClient()
    .getOrCreateCollection({
      name: CHROMA_COLLECTION,
      embeddingFunction: null,
      metadata: { purpose: "apothecary-agent-rag" },
    })
    .catch((error: unknown) => {
      collectionPromise = null;
      throw withChromaHint(error);
    });

  return collectionPromise;
}

export async function indexVault(scopePath?: string): Promise<{ indexed: number }> {
  const vaultPath = getVaultPath();
  const scanRoot = scopePath ? path.join(vaultPath, scopePath) : vaultPath;
  const files = await walkMarkdownFiles(scanRoot);
  const chunks: ChunkDraft[] = [];

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    const relativePath = toPortablePath(path.relative(vaultPath, file));
    chunks.push(...(await buildChunkDrafts(relativePath, content)));
  }

  const embeddings = await embedChunks(chunks);
  const client = getChromaClient();
  await client.deleteCollection({ name: CHROMA_COLLECTION }).catch(() => undefined);
  collectionPromise = null;

  if (chunks.length === 0) {
    await getCollection();
    return { indexed: 0 };
  }

  await upsertChunks(chunks, embeddings);
  return { indexed: chunks.length };
}

export async function reindexFile(relativePath: string): Promise<{ added: number }> {
  const normalizedPath = toPortablePath(relativePath);
  const absolutePath = path.join(getVaultPath(), normalizedPath);
  const content = await fs.readFile(absolutePath, "utf8");
  const chunks = await buildChunkDrafts(normalizedPath, content);

  const collection = await getCollection();
  if (chunks.length === 0) {
    await deleteSourceChunks(collection, normalizedPath);
    return { added: 0 };
  }

  const embeddings = await embedChunks(chunks);
  await deleteSourceChunks(collection, normalizedPath);
  await upsertChunks(chunks, embeddings, collection);

  return { added: chunks.length };
}

export async function removeFromIndex(relativePath: string): Promise<{ removed: number }> {
  const collection = await getCollection();
  const result = await deleteSourceChunks(collection, toPortablePath(relativePath));
  return { removed: result };
}

export async function queryVault(query: string, topK = 5): Promise<SearchResult[]> {
  const cleanedQuery = query.trim();
  if (!cleanedQuery) return [];

  const collection = await getCollection();
  const { embedding } = await embed({ model: getEmbeddingModel(), value: cleanedQuery });
  const result = await collection.query<VaultChunkMetadata>({
    queryEmbeddings: [embedding as unknown as number[]],
    nResults: topK,
    include: ["documents", "metadatas", "distances"],
  });

  const documents = result.documents[0] ?? [];
  const metadatas = result.metadatas[0] ?? [];

  return documents
    .map((document, index): SearchResult | null => {
      const metadata = metadatas[index];
      if (!document || !metadata?.source) return null;

      return {
        source: metadata.source,
        title: metadata.title || undefined,
        headings: parseHeadings(metadata.headingsJson),
        content: document.slice(0, 1000),
      };
    })
    .filter((item): item is SearchResult => item !== null);
}

async function buildChunkDrafts(relativePath: string, content: string): Promise<ChunkDraft[]> {
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
      model: getEmbeddingModel(),
      values: batch.map((chunk) => chunk.content),
    });
    embeddings.push(...(result.embeddings as unknown as number[][]));
  }
  return embeddings;
}

async function upsertChunks(
  chunks: ChunkDraft[],
  embeddings: number[][],
  collection?: Collection,
): Promise<void> {
  if (chunks.length === 0) return;
  const targetCollection = collection ?? (await getCollection());

  await targetCollection.upsert({
    ids: chunks.map((chunk) => chunk.id),
    embeddings,
    documents: chunks.map((chunk) => chunk.content),
    metadatas: chunks.map(toMetadata),
  });
}

async function deleteSourceChunks(collection: Collection, relativePath: string): Promise<number> {
  const before = await collection.get({ where: { source: relativePath }, include: [] });
  await collection.delete({ where: { source: relativePath } });
  return before.ids.length;
}

function toMetadata(chunk: ChunkDraft): Metadata {
  return {
    source: chunk.source,
    title: chunk.title ?? null,
    headingsJson: JSON.stringify(chunk.headings ?? []),
    chunkIndex: chunk.chunkIndex,
    contentHash: chunk.contentHash,
    indexedAt: new Date().toISOString(),
  };
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

function createChunkId(relativePath: string, chunkIndex: number, contentHash: string): string {
  return hashText(`${relativePath}:${chunkIndex}:${contentHash}`);
}

function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function withChromaHint(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    `Chroma is not available at ${CHROMA_HOST}:${CHROMA_PORT}. ` +
      `Start it with: pnpm run chroma. Original error: ${message}`,
  );
}

// ── Heading tree extraction ──

type HeadingNode = { level: number; text: string; position: number };

type VaultChunkMetadata = Metadata & {
  source?: string;
  title?: string | null;
  headingsJson?: string | null;
};

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
  chunkIdx: number,
): number {
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

function toPortablePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function getVaultPath(): string {
  return process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";
}
