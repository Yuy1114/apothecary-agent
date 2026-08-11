import { afterEach, describe, expect, it, vi } from "vitest";
import { speechCommand } from "./speech.js";
import { ingestSpeech } from "../../application/english/ingestSpeech.js";
import { HELP } from "../args.js";

// ingestSpeech 在这里整体打桩：单测不碰真实 AnkiConnect（网络调用不能出现在
// 测试里），speech.ts 里的 ankiConfig() 走真实实现，但只在构造 deps 时读环境
// 变量，不发请求。
vi.mock("../../application/english/ingestSpeech.js", () => ({
  ingestSpeech: vi.fn(),
}));

describe("speechCommand", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps a created outcome to a success result with the note id", async () => {
    vi.mocked(ingestSpeech).mockResolvedValue({ kind: "created", noteId: 42 });

    const result = await speechCommand({
      raw: "Have you think about it?",
      corrected: "Have you thought about it?",
      note: "完成时用过去分词",
    });

    expect(ingestSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        rawText: "Have you think about it?",
        correctedText: "Have you thought about it?",
        note: "完成时用过去分词",
        source: "type4me",
        capturedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      }),
      expect.objectContaining({ config: expect.any(Object) }),
    );
    expect(result.exitCode).toBeUndefined();
    expect(result.json).toEqual({ kind: "created", noteId: 42 });
    expect(result.text).toContain("已入 Anki（noteId 42）");
  });

  it("omits the note when --note is absent", async () => {
    vi.mocked(ingestSpeech).mockResolvedValue({ kind: "created", noteId: 7 });

    const result = await speechCommand({ raw: "raw", corrected: "corrected" });

    expect(ingestSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ note: "", source: "type4me" }),
      expect.anything(),
    );
    expect(result.exitCode).toBeUndefined();
  });

  it("maps a deferred outcome to exitCode 1 and carries the record for a retry", async () => {
    vi.mocked(ingestSpeech).mockResolvedValue({
      kind: "deferred",
      detail: "AnkiConnect 连接失败（Anki 未开）",
    });

    const result = await speechCommand({
      raw: "Have you think about it?",
      corrected: "Have you thought about it?",
    });

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      kind: "deferred",
      detail: "AnkiConnect 连接失败（Anki 未开）",
    });
    // 调用方（cron）靠 json.kind 决定是否重试，record 是重试要重新提交的原文。
    expect(result.json).toMatchObject({
      record: expect.objectContaining({ rawText: "Have you think about it?" }),
    });
    expect(result.text).toContain("Anki 未开，已保留待下次重试");
  });

  it("maps a skipped outcome to exitCode 1 with the reason", async () => {
    vi.mocked(ingestSpeech).mockResolvedValue({
      kind: "skipped",
      detail: "add_failed: model not found",
    });

    const result = await speechCommand({ raw: "raw", corrected: "corrected" });

    expect(result.exitCode).toBe(1);
    expect(result.json).toEqual({ kind: "skipped", detail: "add_failed: model not found" });
    expect(result.text).toContain("add_failed: model not found");
  });

  it("refuses to run without --raw", async () => {
    await expect(speechCommand({ corrected: "Have you thought about it?" })).rejects.toThrow(
      /speech ingest 需要 --raw/,
    );
  });

  it("refuses to run without --corrected", async () => {
    await expect(speechCommand({ raw: "Have you think about it?" })).rejects.toThrow(
      /speech ingest 需要 --corrected/,
    );
  });

  it("is documented in the CLI help text", () => {
    expect(HELP).toContain("apo speech ingest");
    expect(HELP).toContain("--corrected");
  });
});
