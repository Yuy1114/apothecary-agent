import { describe, expect, it, vi } from "vitest";
import { VaultSemanticRecallProcessor } from "./vault-semantic-recall.js";
import { queryVault } from "../tools/rag.js";

vi.mock("../tools/rag.js", () => ({
  queryVault: vi.fn(),
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
    addSystem: vi.fn(() => {
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
