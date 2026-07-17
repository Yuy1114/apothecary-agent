import { describe, expect, it } from "vitest";
import { buildQuickAskPrompt } from "./quickAskPrompt.js";

describe("buildQuickAskPrompt", () => {
  const base = {
    question: "什么是倒排索引？",
    selection: "倒排索引",
    contextText: "## 检索\n全文检索依赖倒排索引。",
    sourceLabel: "vault note references/search.md",
  };

  it("orders source, context, selection and question sections", () => {
    const prompt = buildQuickAskPrompt({ ...base, priorTurns: [] });
    const order = [
      prompt.indexOf("Source: vault note references/search.md"),
      prompt.indexOf('Context:\n"""'),
      prompt.indexOf("全文检索依赖倒排索引"),
      prompt.indexOf('Selected text:\n"""'),
      prompt.indexOf("Question: 什么是倒排索引？"),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("omits the earlier-turns section when there are none", () => {
    const prompt = buildQuickAskPrompt({ ...base, priorTurns: [] });
    expect(prompt).not.toContain("Earlier turns");
  });

  it("renders prior turns as Q/A pairs", () => {
    const prompt = buildQuickAskPrompt({
      ...base,
      priorTurns: [{ question: "第一问", answer: "第一答" }],
    });
    expect(prompt).toContain("Earlier turns in this popover:\nQ: 第一问\nA: 第一答");
  });

  it("keeps only the last two prior turns", () => {
    const prompt = buildQuickAskPrompt({
      ...base,
      priorTurns: [
        { question: "旧问", answer: "旧答" },
        { question: "第二问", answer: "第二答" },
        { question: "第三问", answer: "第三答" },
      ],
    });
    expect(prompt).not.toContain("旧问");
    expect(prompt).toContain("Q: 第二问");
    expect(prompt).toContain("Q: 第三问");
  });
});

describe("direct asks (no selection)", () => {
  const direct = { question: "有没有 ui/ux 相关的内容？", selection: "", contextText: "", sourceLabel: "the current conversation (direct ask, no selection)", priorTurns: [] };

  it("omits empty selection and context blocks entirely", () => {
    const prompt = buildQuickAskPrompt(direct);
    expect(prompt).not.toContain("Selected text:");
    expect(prompt).not.toContain("Context:");
    expect(prompt).toContain("Source: the current conversation (direct ask, no selection)");
    expect(prompt).toContain("Question: 有没有 ui/ux 相关的内容？");
  });

  it("renders related vault excerpts with their paths", () => {
    const prompt = buildQuickAskPrompt({
      ...direct,
      relatedExcerpts: [
        { path: "notes/ui-design.md", excerpt: "按钮的可用性……" },
        { path: "notes/ux-research.md", excerpt: "访谈方法……" },
      ],
    });
    expect(prompt).toContain("Related notes (vault search on the question):");
    expect(prompt).toContain("- notes/ui-design.md:");
    expect(prompt).toContain("按钮的可用性……");
    expect(prompt).toContain("- notes/ux-research.md:");
  });

  it("selection asks carry no related-notes block", () => {
    const prompt = buildQuickAskPrompt({ ...direct, selection: "选中的字", contextText: "上下文" });
    expect(prompt).toContain("Selected text:");
    expect(prompt).not.toContain("Related notes");
  });
});
