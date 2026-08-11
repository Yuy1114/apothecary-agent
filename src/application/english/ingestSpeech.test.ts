import { describe, expect, it, vi } from "vitest";
import {
  extractKeyExpression,
  ingestSpeech,
  renderSpeechBack,
  SPEECH_TAG,
} from "./ingestSpeech.js";
import { CAPTURE_DECK, CAPTURE_MODEL, CAPTURE_TAG } from "./ingestCapture.js";
import type { AnkiConfig } from "./ankiConnect.js";

type AnkiCall = { action: string; params: Record<string, unknown> };

/** 与 ingestCapture.test.ts 同款 fake AnkiConnect——测试注入 mock，不碰真实 Anki。 */
function fakeAnki(results: Record<string, unknown>) {
  const calls: AnkiCall[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as AnkiCall;
    calls.push({ action: body.action, params: body.params });
    return new Response(JSON.stringify({ result: results[body.action] ?? null, error: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const config: AnkiConfig = {
    url: "http://127.0.0.1:8765",
    timeoutMs: 1_000,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  };
  return { config, fetchImpl, calls, actions: () => calls.map((c) => c.action) };
}

const record = {
  rawText: "I am very like this movie.",
  correctedText: "I really enjoy this movie.",
  note: "very like 是中式表达，really enjoy 更地道",
  source: "type4me" as const,
  capturedAt: "2026-08-11T12:00:00.000Z",
};

describe("extractKeyExpression", () => {
  it("提取 correctedText 里新增的地道表达（rawText 里没有的词位组成的最长片段）", () => {
    expect(extractKeyExpression(record.rawText, record.correctedText)).toBe("really enjoy");
  });

  it("单点替换时提取替换词", () => {
    expect(extractKeyExpression("I very like this book.", "I really like this book.")).toBe(
      "really",
    );
  });

  it("纯删词 / 整句重写时退回整句 correctedText", () => {
    expect(extractKeyExpression("I am agree with you.", "I agree with you.")).toBe(
      "I agree with you.",
    );
  });
});

describe("renderSpeechBack", () => {
  it("背面包含原句和中文说明", () => {
    const back = renderSpeechBack(record);
    expect(back).toContain("I am very like this movie.");
    expect(back).toContain("really enjoy 更地道");
  });

  it("转义 HTML，避免原句/说明里的标记破坏卡片排版", () => {
    const back = renderSpeechBack({ ...record, note: "固定搭配 <b>不要</b> 直译" });
    expect(back).toContain("固定搭配 &lt;b&gt;不要&lt;/b&gt; 直译");
  });
});

describe("ingestSpeech", () => {
  it("Anki 开着时建卡成功：deck/model/正反面/tags 正确", async () => {
    const anki = fakeAnki({ addNote: 7001 });

    const outcome = await ingestSpeech(record, { config: anki.config });

    expect(outcome).toEqual({ kind: "created", noteId: 7001 });
    // 只调 addNote 一个动作，且打到注入的 mock URL，不碰真实 Anki。
    expect(anki.actions()).toEqual(["addNote"]);
    expect(anki.fetchImpl).toHaveBeenCalledTimes(1);
    expect(anki.fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8765",
      expect.objectContaining({ method: "POST" }),
    );

    const call = anki.calls.find((c) => c.action === "addNote");
    const note = call?.params.note as {
      deckName: string;
      modelName: string;
      fields: { Front: string; Back: string };
      tags: string[];
      options: { allowDuplicate: boolean; duplicateScope: string };
    };
    expect(note.deckName).toBe(CAPTURE_DECK);
    expect(note.modelName).toBe(CAPTURE_MODEL);
    expect(note.fields.Front).toBe("really enjoy");
    expect(note.fields.Back).toContain("I am very like this movie.");
    expect(note.fields.Back).toContain("really enjoy 更地道");
    expect(note.tags).toEqual([SPEECH_TAG, CAPTURE_TAG]);
    // 沿用阅读模式的全库查重 backstop。
    expect(note.options).toMatchObject({ allowDuplicate: false, duplicateScope: "collection" });
  });

  it("Anki 关着时返回 deferred（调用方保留记录，下次再试）", async () => {
    const config: AnkiConfig = {
      url: "http://127.0.0.1:8765",
      timeoutMs: 1_000,
      fetchImpl: (async () => {
        throw new Error("connect ECONNREFUSED");
      }) as unknown as typeof fetch,
    };

    const outcome = await ingestSpeech(record, { config });

    expect(outcome).toMatchObject({ kind: "deferred" });
  });

  it("Anki 可达但 addNote 报错时返回 skipped（与 ingestCapture 同款语义）", async () => {
    const config: AnkiConfig = {
      url: "http://127.0.0.1:8765",
      timeoutMs: 1_000,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ result: null, error: "deck not found" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch,
    };

    const outcome = await ingestSpeech(record, { config });

    expect(outcome).toEqual({ kind: "skipped", detail: "add_failed: deck not found" });
  });

  it("没有纠错内容时跳过，不调 Anki", async () => {
    const anki = fakeAnki({});

    const outcome = await ingestSpeech(
      { ...record, correctedText: "   " },
      { config: anki.config },
    );

    expect(outcome).toEqual({ kind: "skipped", detail: "no_corrected_text" });
    expect(anki.calls).toEqual([]);
  });
});
