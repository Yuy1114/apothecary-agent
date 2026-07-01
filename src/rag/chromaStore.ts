import { promises as fs } from "node:fs";
import path from "node:path";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";
const INDEX_PATH = path.join(VAULT_PATH, ".agent", "rag-index.json");

type IndexedChunk = {
  source: string;
  content: string;
  title?: string;
};

let index: IndexedChunk[] | null = null;

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
  const chunks: IndexedChunk[] = [];

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    const relativePath = path.relative(VAULT_PATH, file);

    // Split by headings for meaningful chunks
    const sections = content.split(/(?=^#{1,3}\s)/m).filter((s) => s.trim().length > 50);

    // Also store a full-content chunk for each file
    chunks.push({
      source: relativePath,
      content: content.slice(0, 3000),
      title: extractTitle(content, relativePath),
    });

    for (const section of sections) {
      chunks.push({
        source: relativePath,
        content: section.slice(0, 2000),
        title: extractTitle(content, relativePath),
      });
    }
  }

  await fs.mkdir(path.dirname(INDEX_PATH), { recursive: true });
  await fs.writeFile(INDEX_PATH, JSON.stringify(chunks), "utf8");

  index = chunks;
  return { indexed: chunks.length };
}

/**
 * Simple relevance-based search: token overlap between query and each chunk.
 */
export async function queryVault(query: string, topK = 5): Promise<Array<{ source: string; content: string }>> {
  const chunks = await loadIndex();
  if (chunks.length === 0) return [];

  const queryTokens = tokenize(query.toLowerCase());

  const scored = chunks.map((chunk) => {
    const chunkTokens = tokenize(chunk.content.toLowerCase());
    const overlap = queryTokens.filter((t) => chunkTokens.includes(t)).length;
    // Boost exact phrase matches
    const phraseBoost = chunk.content.toLowerCase().includes(query.toLowerCase()) ? 2 : 0;
    return { chunk, score: overlap + phraseBoost };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => ({
      source: s.chunk.source,
      content: s.chunk.content.slice(0, 1000),
    }));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,.;:!?()\[\]{}"']+/)
    .filter((t) => t.length > 1);
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
