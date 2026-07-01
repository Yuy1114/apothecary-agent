import { describe, expect, it, vi } from "vitest";
import { OpenAIReviewerModel } from "./openaiReviewerModel.js";

vi.mock("openai", () => {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            topics: [
              {
                title: "projects/test",
                category: "project",
                summary: "A test project.",
                keyConcepts: ["Architecture", "API"],
                relatedFiles: [
                  { path: "projects/test/design.md", title: "Design", summary: "Design doc", role: "overview", relevance: 0.8 },
                ],
                openQuestions: [],
                confidence: 0.7,
              },
            ],
            summary: "1 topic from 1 file.",
          }),
        },
      },
    ],
  });

  const MockOpenAI = vi.fn(function (this: Record<string, unknown>) {
    this.chat = { completions: { create: mockCreate } };
  });

  return { default: MockOpenAI };
});

describe("OpenAIReviewerModel", () => {
  it("generates a knowledge map by calling the OpenAI-compatible API", async () => {
    const reviewer = new OpenAIReviewerModel({ model: "test-model", apiKey: "test-key" });

    const map = await reviewer.generateKnowledgeMap({
      context: {
        scanId: "scan-1",
        vaultPath: "/tmp/vault",
        scannedAt: "2026-07-01T00:00:00.000Z",
        stats: {
          totalFiles: 1,
          markdownFiles: 1,
          pdfFiles: 0,
          imageFiles: 0,
          otherFiles: 0,
          totalBytes: 200,
          recentlyChangedFiles: ["projects/test/design.md"],
          topLevelDirectories: [],
        },
        files: [
          {
            path: "projects/test/design.md",
            mediaType: "markdown" as const,
            layer: "unknown" as const,
            sizeBytes: 200,
            lineCount: 10,
            wordCount: 50,
            updatedAt: "2026-07-01T00:00:00.000Z",
            frontmatterKeys: [],
            headingTitles: ["Architecture", "API"],
            excerpt: "System architecture and API design.",
          },
        ],
      },
      options: { maxTopics: 10, maxFilesPerTopic: 5 },
    });

    expect(map.topics).toHaveLength(1);
    expect(map.topics[0]).toMatchObject({
      title: "projects/test",
      keyConcepts: ["Architecture", "API"],
    });
    expect(map.summary).toContain("1 topic");
  });
});
