import { describe, expect, it } from "vitest";
import { parseMarkdownSnapshot } from "./markdown.js";

describe("parseMarkdownSnapshot title", () => {
  it("prefers the frontmatter title", () => {
    const snap = parseMarkdownSnapshot(
      "notes/a.md",
      "---\ntitle: 真标题\n---\n# 一级标题\n正文",
    );
    expect(snap.title).toBe("真标题");
  });

  it("uses the first H1 when there is no frontmatter title", () => {
    const snap = parseMarkdownSnapshot("notes/a.md", "# 文档标题\n\n## 小节\n正文");
    expect(snap.title).toBe("文档标题");
  });

  it("falls back to the file name for a section-structured note (H2 first)", () => {
    // The inbox bug: notes that open with `## 1. …` carry their real title in
    // the file name; the opening section must not masquerade as the title.
    const snap = parseMarkdownSnapshot(
      "_inbox/Event Loop（事件循环）知识笔记.md",
      "## 1. Event Loop 是什么？\n\nEvent Loop 是……",
    );
    expect(snap.title).toBe("Event Loop（事件循环）知识笔记");
  });

  it("treats a mid-document H1 as a section, not the title", () => {
    // Real inbox exports mix `#` and `##` for sections (e.g. `## 1.` … `# 2.`);
    // an H1 that is not the opening line must not become the title.
    const snap = parseMarkdownSnapshot(
      "_inbox/混排笔记.md",
      "## 1. 开篇小节\n\n正文……\n\n# 2. 中途的一级小节\n再来一段",
    );
    expect(snap.title).toBe("混排笔记");
  });

  it("falls back to the file name when there are no headings at all", () => {
    const snap = parseMarkdownSnapshot("_inbox/随手记.md", "就是一段随手记的内容。");
    expect(snap.title).toBe("随手记");
  });
});
