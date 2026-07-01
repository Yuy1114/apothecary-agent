import { describe, expect, it } from "vitest";
import type { MaintenanceReviewContext, ReviewerFileContext } from "./reviewerContext.js";
import { DeterministicReviewerModel } from "./deterministicReviewerModel.js";

describe("DeterministicReviewerModel", () => {
  it("uses headings and excerpts to make deterministic knowledge maps more informative", async () => {
    const reviewer = new DeterministicReviewerModel();

    const map = await reviewer.generateKnowledgeMap({
      context: makeContext([
        makeFile("projects/apothecary-agent/PRD.md", {
          headingTitles: ["Vision", "MVP Boundary", "Review Flow"],
          excerpt: "Read-only reviewer for a local Markdown vault.",
        }),
        makeFile("projects/apothecary-agent/VISION.md", {
          headingTitles: ["Vision", "Knowledge Entropy"],
          excerpt: "Reduce knowledge entropy through safe maintenance reports.",
        }),
      ]),
      options: {
        maxTopics: 10,
        maxFilesPerTopic: 10,
      },
    });

    expect(map.topics[0]).toMatchObject({
      title: "projects/apothecary-agent",
      keyConcepts: ["Vision", "MVP Boundary", "Review Flow", "Knowledge Entropy"],
      summary: "projects/apothecary-agent contains 2 markdown file(s). Common headings: Vision, MVP Boundary, Review Flow.",
    });
    expect(map.topics[0]?.relatedFiles[0]?.summary).toContain("Headings: Vision, MVP Boundary, Review Flow");
    expect(map.topics[0]?.relatedFiles[0]?.summary).toContain("Excerpt: Read-only reviewer for a local Markdown vault.");
  });

  it("finds missing indexes, stale notes, unclear titles, and orphan notes from reviewer context", async () => {
    const reviewer = new DeterministicReviewerModel();

    const review = await reviewer.generateMaintenanceReview({
      context: makeContext([
        makeFile("projects/apothecary-agent/PRD.md"),
        makeFile("projects/apothecary-agent/VISION.md"),
        makeFile("projects/apothecary-agent/old-plan.md"),
        makeFile("random/untitled-note.md"),
      ]),
      options: {
        longContextLineThreshold: 300,
        longContextWordThreshold: 5000,
      },
    });

    expect(review.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "missing_index", filePaths: expect.arrayContaining(["projects/apothecary-agent/PRD.md"]) }),
        expect.objectContaining({ type: "stale_note", filePaths: ["projects/apothecary-agent/old-plan.md"] }),
        expect.objectContaining({ type: "unclear_location", filePaths: ["random/untitled-note.md"] }),
        expect.objectContaining({ type: "orphan_note", filePaths: ["random/untitled-note.md"] }),
      ]),
    );
  });
});

function makeContext(files: ReviewerFileContext[]): MaintenanceReviewContext {
  return {
    scanId: "scan-test",
    vaultPath: "/tmp/vault",
    scannedAt: "2026-07-01T00:00:00.000Z",
    stats: {
      totalFiles: files.length,
      markdownFiles: files.length,
      pdfFiles: 0,
      imageFiles: 0,
      otherFiles: 0,
      totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      recentlyChangedFiles: files.map((file) => file.path),
      topLevelDirectories: [],
    },
    files,
  };
}

function makeFile(filePath: string, overrides: Partial<ReviewerFileContext> = {}): ReviewerFileContext {
  return {
    path: filePath,
    mediaType: "markdown",
    layer: "unknown",
    sizeBytes: 100,
    lineCount: 10,
    wordCount: 100,
    updatedAt: "2026-07-01T00:00:00.000Z",
    frontmatterKeys: [],
    headingTitles: [],
    ...overrides,
  };
}
