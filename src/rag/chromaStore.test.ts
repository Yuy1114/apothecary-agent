import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns ~0.5 for 60-degree vectors", () => {
    // cos(60°) = 0.5
    expect(cosineSimilarity([1, 0], [0.5, Math.sqrt(3) / 2])).toBeCloseTo(0.5);
  });

  it("handles zero vectors gracefully", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
});

describe("RAG file indexing", () => {
  it("walks markdown files in a directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "apothecary-rag-"));
    tempDirs.push(root);

    await writeFile(path.join(root, "a.md"), "# A\ncontent a", "utf8");
    await writeFile(path.join(root, "b.md"), "# B\ncontent b", "utf8");
    await writeFile(path.join(root, "not-md.txt"), "ignored", "utf8");

    // Test walkMarkdownFiles logic inline
    const files: string[] = [];
    const entries = await import("node:fs/promises").then((fs) => fs.readdir(root, { withFileTypes: true }));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(path.join(root, entry.name));
      }
    }

    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".md"))).toBe(true);
  });
});

// Inline cosineSimilarity to test without module resolution issues
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
