import { describe, expect, it } from "vitest";
import { validatePolishDraft, MIN_BODY_RATIO, type NotePolishDraft } from "./notePolish.js";

const draft = (overrides: Partial<NotePolishDraft> = {}): NotePolishDraft => ({
  body: "# 标题\n\n润色后的内容。",
  addTags: [],
  changeSummary: "调整了标题层级",
  ...overrides,
});

describe("validatePolishDraft", () => {
  it("accepts a same-length format-only polish", () => {
    const result = validatePolishDraft("# 标题\n\n原始内容。", draft(), ["format"]);
    expect(result.ok).toBe(true);
  });

  it("rejects an empty or whitespace-only body", () => {
    const result = validatePolishDraft("original", draft({ body: "   \n  " }), ["format"]);
    expect(result).toEqual({ ok: false, reason: "empty_body" });
  });

  it("rejects silent shrinkage when expand was not selected", () => {
    const original = "一".repeat(200);
    const shrunk = "一".repeat(Math.floor(200 * MIN_BODY_RATIO) - 5);
    const result = validatePolishDraft(original, draft({ body: shrunk }), ["format", "tags"]);
    expect(result).toEqual({ ok: false, reason: "body_shrunk" });
  });

  it("allows shrinkage-relative growth checks to pass when expand is selected", () => {
    const original = "一".repeat(200);
    const result = validatePolishDraft(original, draft({ body: "一".repeat(100) }), ["expand"]);
    expect(result.ok).toBe(true);
  });

  it("drops tags when the tags mode was not selected", () => {
    const result = validatePolishDraft("原文", draft({ addTags: ["redis", "缓存"] }), ["format"]);
    expect(result.ok && result.draft.addTags).toEqual([]);
  });

  it("keeps trimmed, non-empty tags when the tags mode is selected", () => {
    const result = validatePolishDraft(
      "原文",
      draft({ addTags: [" redis ", "", "缓存"] }),
      ["tags"],
    );
    expect(result.ok && result.draft.addTags).toEqual(["redis", "缓存"]);
  });
});

describe("condense mode", () => {
  it("exempts the shrink guard — condensing is the point", () => {
    const original = "很".repeat(400);
    const result = validatePolishDraft(original, draft({ body: "浓缩后的两句话。" }), ["condense"]);
    expect(result.ok).toBe(true);
  });

  it("still rejects an empty condense result", () => {
    const result = validatePolishDraft("原文", draft({ body: "   " }), ["condense"]);
    expect(result).toEqual({ ok: false, reason: "empty_body" });
  });
});
