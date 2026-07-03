import { describe, expect, it, vi } from "vitest";
import { VaultSemanticRecallProcessor } from "./vault-semantic-recall.js";
import { queryVault } from "../tools/rag.js";
import { loadSummaries } from "../../vault/semanticStore.js";

vi.mock("../tools/rag.js", () => ({
  queryVault: vi.fn(),
}));

vi.mock("../../vault/semanticStore.js", () => ({
  loadSummaries: vi.fn(async () => ({})),
}));

describe("VaultSemanticRecallProcessor", () => {
  it("injects retrieved vault excerpts as a tagged system message", async () => {
    vi.mocked(queryVault).mockResolvedValueOnce([
      {
        source: "projects/apothecary-agent/README.md",
        title: "Apothecary Agent",
        headings: ["Vision", "Evidence"],
        content: "Semantic search should provide evidence chains.",
      },
    ]);

    const messages = [{ role: "user", content: { parts: [{ type: "text", text: "怎么处理证据链？" }] } }];
    const messageList = makeMessageList("怎么处理证据链？");
    const processor = new VaultSemanticRecallProcessor();

    const result = await processor.processInput(makeArgs({ messageList, messages }));

    expect(queryVault).toHaveBeenCalledWith("怎么处理证据链？", 5);
    expect(messageList.addSystem).toHaveBeenCalledWith(
      expect.stringContaining("projects/apothecary-agent/README.md — Apothecary Agent > Vision > Evidence"),
      "vault-semantic-recall",
    );
    expect(result).toBe(messageList);
  });

  it("expands a retrieved source with its file summary when available", async () => {
    vi.mocked(queryVault).mockResolvedValueOnce([
      {
        source: "notes/programming/Redis/Redis.md",
        title: "Redis",
        headings: [],
        content: "AOF appends write commands to a log.",
      },
    ]);
    vi.mocked(loadSummaries).mockResolvedValueOnce({
      "notes/programming/Redis/Redis.md": {
        path: "notes/programming/Redis/Redis.md",
        contentHash: "h",
        generatedAt: "2026-07-02T00:00:00.000Z",
        title: "Redis",
        gist: "Overview of Redis persistence and caching.",
        topics: ["Redis", "Persistence"],
        concepts: ["AOF", "RDB"],
        summary: "s",
      },
    });

    const messageList = makeMessageList("AOF 是什么");
    const processor = new VaultSemanticRecallProcessor();
    await processor.processInput(makeArgs({ messageList, messages: [] }));

    const injected = vi.mocked(messageList.addSystem).mock.calls[0][0] as string;
    expect(injected).toContain("File summary: Overview of Redis persistence and caching.");
    expect(injected).toContain("topics: Redis, Persistence");
  });

  it("annotates a superseded source so the model prefers the canonical note", async () => {
    vi.mocked(queryVault).mockResolvedValueOnce([
      {
        source: "notes/old.md",
        title: "Old",
        headings: [],
        content: "an outdated take",
        supersededBy: "notes/canonical.md",
      },
    ]);

    const messageList = makeMessageList("旧观点");
    const processor = new VaultSemanticRecallProcessor();
    await processor.processInput(makeArgs({ messageList, messages: [] }));

    const injected = vi.mocked(messageList.addSystem).mock.calls[0][0] as string;
    expect(injected).toContain("Superseded by notes/canonical.md");
  });

  it("leaves messages unchanged when there is no recall context", async () => {
    vi.mocked(queryVault).mockResolvedValueOnce([]);

    const messages = [{ role: "user", content: { parts: [{ type: "text", text: "不存在的问题" }] } }];
    const messageList = makeMessageList("不存在的问题");
    const processor = new VaultSemanticRecallProcessor();

    const result = await processor.processInput(makeArgs({ messageList, messages }));

    expect(messageList.addSystem).not.toHaveBeenCalled();
    expect(result).toBe(messages);
  });
});

function makeMessageList(query: string) {
  const messageList = {
    getLatestUserContent: vi.fn(() => query),
    addSystem: vi.fn((_content: string, _id: string) => {
      return messageList;
    }),
  };
  return messageList;
}

function makeArgs(input: { messageList: unknown; messages: unknown[] }) {
  return {
    messageList: input.messageList,
    messages: input.messages,
  } as Parameters<VaultSemanticRecallProcessor["processInput"]>[0];
}
