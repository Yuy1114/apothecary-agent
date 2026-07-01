import { describe, expect, it } from "vitest";
import type { VaultScan } from "../domain/vault.js";
import { buildKnowledgeMapContext } from "./buildReviewerContext.js";

describe("buildReviewerContext", () => {
  it("keeps safe Markdown headings and a bounded excerpt without exposing full frontmatter values", () => {
    const context = buildKnowledgeMapContext(makeScan(), { maxFiles: 100, minSizeBytes: 0 });

    expect(context.files[0]).toMatchObject({
      path: "projects/apothecary-agent/PRD.md",
      headingTitles: ["Vision", "MVP"],
      excerpt: "This is a useful bounded excerpt for reviewer context.",
      frontmatterKeys: ["secret", "title"],
    });
    expect(context.files[0]).not.toHaveProperty("frontmatter");
  });
});

function makeScan(): VaultScan {
  return {
    id: "scan-test",
    vaultPath: "/tmp/vault",
    scannedAt: "2026-07-01T00:00:00.000Z",
    files: [
      {
        path: "projects/apothecary-agent/PRD.md",
        absolutePath: "/tmp/vault/projects/apothecary-agent/PRD.md",
        extension: ".md",
        mediaType: "markdown",
        title: "Project PRD",
        frontmatter: {
          secret: "do not expose value",
          title: "Project PRD",
        },
        headings: [
          { level: 1, text: "Vision", line: 1 },
          { level: 2, text: "MVP", line: 10 },
        ],
        excerpt: "This is a useful bounded excerpt for reviewer context.",
        sizeBytes: 100,
        lineCount: 20,
        wordCount: 50,
        updatedAt: "2026-07-01T00:00:00.000Z",
        layer: "unknown",
      },
    ] as VaultScan["files"],
    stats: {
      totalFiles: 1,
      markdownFiles: 1,
      pdfFiles: 0,
      imageFiles: 0,
      otherFiles: 0,
      totalBytes: 100,
      topLevelDirectories: [],
      recentlyChangedFiles: ["projects/apothecary-agent/PRD.md"],
    },
  };
}
