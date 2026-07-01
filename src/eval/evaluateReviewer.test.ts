import { describe, expect, it } from "vitest";
import type { MaintenanceReviewContext, ReviewerFileContext } from "../reviewer/reviewerContext.js";
import { DeterministicReviewerModel } from "../reviewer/deterministicReviewerModel.js";
import { evaluateReviewer } from "./evaluateReviewer.js";

const testReviewOptions = {
  longContextWordThreshold: 5000,
  longContextLineThreshold: 300,
};

const testMapOptions = {
  maxTopics: 10,
  maxFilesPerTopic: 10,
};

describe("evaluateReviewer", () => {
  it("scores deterministic reviewer at 100% coverage against itself", async () => {
    const reviewer = new DeterministicReviewerModel();
    // 3 files in same dir, no index → missing_index
    // old-plan → stale_note
    const context = makeContext([
      makeFile("projects/test/PRD.md", ["Vision"]),
      makeFile("projects/test/arch.md", ["Architecture"]),
      makeFile("projects/test/notes.md", ["Notes"]),
      makeFile("projects/test/old-plan.md", ["Old Plan"]),
    ]);

    const result = await evaluateReviewer("deterministic", reviewer, context, testMapOptions, testReviewOptions);

    expect(result.coverage).toBe(1);
    expect(result.missingFromBaseline).toEqual([]);
    expect(result.findingTypes).toContain("missing_index");
    expect(result.findingTypes).toContain("stale_note");
  });

  it("detects when a reviewer misses baseline findings", async () => {
    const emptyReviewer = {
      generateKnowledgeMap: async () => ({ topics: [], summary: "" }),
      generateMaintenanceReview: async () => ({
        id: "empty",
        vaultPath: "/tmp",
        generatedAt: "",
        basedOnScanId: "",
        findings: [],
        summary: "",
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    // Context that triggers deterministic findings
    const context = makeContext([
      makeFile("projects/test/PRD.md", ["Vision"]),
      makeFile("projects/test/arch.md", ["Architecture"]),
      makeFile("projects/test/notes.md", ["Notes"]),
      makeFile("projects/test/old-plan.md", ["Old Plan"]),
    ]);

    const result = await evaluateReviewer("empty", emptyReviewer, context, testMapOptions, testReviewOptions);

    expect(result.coverage).toBe(0);
    expect(result.missingFromBaseline.length).toBeGreaterThan(0);
    expect(result.totalFindings).toBe(0);
  });
});

function makeContext(files: ReviewerFileContext[]): MaintenanceReviewContext {
  return {
    scanId: "test",
    vaultPath: "/tmp",
    scannedAt: "",
    stats: {
      totalFiles: files.length,
      markdownFiles: files.length,
      pdfFiles: 0,
      imageFiles: 0,
      otherFiles: 0,
      totalBytes: 0,
      recentlyChangedFiles: [],
      topLevelDirectories: [],
    },
    files,
  };
}

function makeFile(filePath: string, headings: string[] = []): ReviewerFileContext {
  return {
    path: filePath,
    mediaType: "markdown",
    layer: "unknown",
    sizeBytes: 100,
    lineCount: 10,
    wordCount: 100,
    updatedAt: "",
    frontmatterKeys: [],
    headingTitles: headings,
  };
}
