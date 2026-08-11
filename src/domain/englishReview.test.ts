import { describe, expect, it } from "vitest";
import { parseEnglishReviewFrontmatter } from "./englishReview.js";

const validMd = `---
type: english-review
date: 2026-08-11
sentences: 3
topics: [tense, preposition]
---

昨天说了三句，动词时态和介词各纠一处。
`;

describe("parseEnglishReviewFrontmatter", () => {
  it("合法 frontmatter 解析通过", () => {
    const result = parseEnglishReviewFrontmatter(validMd);
    expect(result).toEqual({
      ok: true,
      data: {
        type: "english-review",
        date: "2026-08-11",
        sentences: 3,
        topics: ["tense", "preposition"],
      },
    });
  });

  it("缺 date 时返回具体原因", () => {
    const result = parseEnglishReviewFrontmatter(validMd.replace("date: 2026-08-11\n", ""));
    expect(result).toEqual({ ok: false, reason: "missing_date" });
  });

  it("type 不是 english-review 时返回具体原因", () => {
    const result = parseEnglishReviewFrontmatter(
      validMd.replace("english-review", "reading-notes"),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_type" });
  });

  it("type 缺失时返回 missing_type", () => {
    const result = parseEnglishReviewFrontmatter(validMd.replace("type: english-review\n", ""));
    expect(result).toEqual({ ok: false, reason: "missing_type" });
  });

  it("topics 不是数组时返回具体原因", () => {
    const result = parseEnglishReviewFrontmatter(
      validMd.replace("topics: [tense, preposition]", "topics: tense"),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_topics" });
  });

  it("topics 数组里混入非字符串时返回 invalid_topics", () => {
    const result = parseEnglishReviewFrontmatter(
      validMd.replace("topics: [tense, preposition]", "topics: [tense, 3]"),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_topics" });
  });

  it("缺 sentences 时返回 missing_sentences", () => {
    const result = parseEnglishReviewFrontmatter(validMd.replace("sentences: 3\n", ""));
    expect(result).toEqual({ ok: false, reason: "missing_sentences" });
  });

  it("sentences 不是非负整数时返回 invalid_sentences", () => {
    const negative = parseEnglishReviewFrontmatter(validMd.replace("sentences: 3", "sentences: -1"));
    expect(negative).toEqual({ ok: false, reason: "invalid_sentences" });
    const fractional = parseEnglishReviewFrontmatter(
      validMd.replace("sentences: 3", "sentences: 3.5"),
    );
    expect(fractional).toEqual({ ok: false, reason: "invalid_sentences" });
  });

  it("字符串形态（引号包裹）的不存在日期返回 invalid_date", () => {
    const result = parseEnglishReviewFrontmatter(
      validMd.replace('date: 2026-08-11', 'date: "2026-02-31"'),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_date" });
  });

  it("引号包裹的 date 字符串同样通过", () => {
    const result = parseEnglishReviewFrontmatter(
      validMd.replace("date: 2026-08-11", 'date: "2026-08-11"'),
    );
    expect(result.ok && result.data.date).toBe("2026-08-11");
  });

  it("没有 frontmatter 时返回 missing_type", () => {
    expect(parseEnglishReviewFrontmatter("没有 frontmatter 的正文。")).toEqual({
      ok: false,
      reason: "missing_type",
    });
  });
});
