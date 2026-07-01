import { describe, expect, it } from "vitest";
import type { MaintenanceReviewContext, ReviewerFileContext } from "./reviewerContext.js";
import { DeterministicReviewerModel } from "./deterministicReviewerModel.js";

describe("DeterministicReviewerModel", () => {
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

function makeFile(filePath: string): ReviewerFileContext {
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
  };
}
