export type AgentRunEvent =
  | { type: "status"; phase: "started" | "thinking"; label: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; toolCallId: string; toolName: string }
  | { type: "tool_completed"; toolCallId: string; toolName: string; failed: boolean }
  | { type: "proposal"; proposal: Record<string, unknown> }
  | { type: "completed" }
  | { type: "failed"; message: string };

type MastraChunk = { type?: string; payload?: Record<string, unknown> };

export function eventFromMastraChunk(chunk: unknown): AgentRunEvent | null {
  if (!chunk || typeof chunk !== "object") return null;
  const { type, payload = {} } = chunk as MastraChunk;
  if (type === "step-start") return { type: "status", phase: "thinking", label: "Agent 正在规划下一步" };
  if (type === "text-delta" && typeof payload.text === "string") {
    return { type: "text_delta", text: payload.text };
  }
  if (type === "tool-call" && typeof payload.toolCallId === "string" && typeof payload.toolName === "string") {
    return { type: "tool_started", toolCallId: payload.toolCallId, toolName: payload.toolName };
  }
  if (type === "tool-result" && typeof payload.toolCallId === "string" && typeof payload.toolName === "string") {
    return {
      type: "tool_completed",
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
      failed: payload.isError === true,
    };
  }
  if (type === "tool-error" && typeof payload.toolCallId === "string") {
    return {
      type: "tool_completed",
      toolCallId: payload.toolCallId,
      toolName: typeof payload.toolName === "string" ? payload.toolName : "unknown",
      failed: true,
    };
  }
  if (type === "error") {
    const error = payload.error;
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Agent 执行失败";
    return { type: "failed", message };
  }
  return null;
}
