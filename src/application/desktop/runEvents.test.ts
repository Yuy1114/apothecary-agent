import { describe, expect, it } from "vitest";
import { eventFromMastraChunk } from "./runEvents.js";

describe("desktop Agent Run events", () => {
  it("maps text and tool lifecycle chunks without exposing tool payloads", () => {
    expect(eventFromMastraChunk({ type: "text-delta", payload: { id: "x", text: "你好" } })).toEqual({
      type: "text_delta",
      text: "你好",
    });
    expect(eventFromMastraChunk({
      type: "tool-call",
      payload: { toolCallId: "call-1", toolName: "scanVault", args: { private: "content" } },
    })).toEqual({ type: "tool_started", toolCallId: "call-1", toolName: "scanVault" });
    expect(eventFromMastraChunk({
      type: "tool-result",
      payload: { toolCallId: "call-1", toolName: "scanVault", result: { private: "content" } },
    })).toEqual({ type: "tool_completed", toolCallId: "call-1", toolName: "scanVault", failed: false });
  });

  it("maps stream errors into a renderer-safe failure", () => {
    expect(eventFromMastraChunk({ type: "error", payload: { error: "provider down" } })).toEqual({
      type: "failed",
      message: "provider down",
    });
  });
});
