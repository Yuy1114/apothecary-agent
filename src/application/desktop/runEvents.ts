export type ProposalDecisionState = { proposalId: string; title: string; type: string; targetFiles: string[] };

export type AgentRunEvent =
  | { type: "status"; phase: "started" | "thinking"; label: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; toolCallId: string; toolName: string }
  | { type: "tool_completed"; toolCallId: string; toolName: string; failed: boolean }
  | { type: "awaiting_decision"; toolCallId: string; proposal: ProposalDecisionState }
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
  if (type === "tool-call-suspended" && typeof payload.toolCallId === "string") {
    const suspend = (payload.suspendPayload ?? {}) as Record<string, unknown>;
    if (typeof suspend.proposalId === "string") {
      return {
        type: "awaiting_decision",
        toolCallId: payload.toolCallId,
        proposal: {
          proposalId: suspend.proposalId,
          title: typeof suspend.title === "string" ? suspend.title : "待确认提案",
          type: typeof suspend.type === "string" ? suspend.type : "unknown",
          targetFiles: Array.isArray(suspend.targetFiles) ? (suspend.targetFiles as string[]) : [],
        },
      };
    }
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
