import { describe, expect, it } from "vitest";
import { sliceEnclosingSection } from "./quickAskSection.js";

const note = [
  "开头没有标题的引言段落。",
  "",
  "# 检索",
  "全文检索依赖倒排索引，倒排索引把词映射到文档。",
  "",
  "## 排序",
  "BM25 是经典的相关性打分函数。",
  "它比 TF-IDF 多了长度归一化。",
  "",
  "# 存储",
  "列式存储适合分析型查询。",
].join("\n");

describe("sliceEnclosingSection", () => {
  it("slices the section between its heading and the next heading", () => {
    const section = sliceEnclosingSection(note, "BM25 是经典的相关性打分函数。");
    expect(section).toContain("## 排序");
    expect(section).toContain("长度归一化");
    expect(section).not.toContain("倒排索引");
    expect(section).not.toContain("列式存储");
  });

  it("covers text before the first heading up to that heading", () => {
    const section = sliceEnclosingSection(note, "引言段落");
    expect(section).toContain("开头没有标题的引言段落。");
    expect(section).not.toContain("全文检索");
  });

  it("runs the last section to the end of the note", () => {
    const section = sliceEnclosingSection(note, "列式存储");
    expect(section).toContain("# 存储");
    expect(section).toContain("分析型查询");
    expect(section).not.toContain("BM25");
  });

  it("finds selections whose rendered whitespace diverged from the source", () => {
    // The renderer joins these two source lines; the DOM selection has a space
    // where the raw note has a newline.
    const section = sliceEnclosingSection(note, "BM25 是经典的相关性打分函数。 它比 TF-IDF 多了长度归一化。");
    expect(section).toContain("## 排序");
    expect(section).not.toContain("列式存储");
  });

  it("falls back to the capped head of the note when the selection is not found", () => {
    expect(sliceEnclosingSection(note, "完全不存在的内容", 20)).toBe(note.slice(0, 20));
  });

  it("keeps the selection inside a cap-sized window of an oversized section", () => {
    const filler = "很长的填充。".repeat(200);
    const long = `# 长节\n${filler}目标句子在这里。${filler}`;
    const section = sliceEnclosingSection(long, "目标句子在这里。", 300);
    expect(section.length).toBeLessThanOrEqual(300);
    expect(section).toContain("目标句子在这里。");
  });

  it("degrades to a capped window for heading-less plain text", () => {
    const plain = `${"a".repeat(100)}目标${"b".repeat(100)}`;
    const section = sliceEnclosingSection(plain, "目标", 50);
    expect(section.length).toBeLessThanOrEqual(50);
    expect(section).toContain("目标");
  });
});
