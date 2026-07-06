type ChatMessage = { role: "user" | "assistant"; content: string };
type ProposalDecisionState = { proposalId: string; title: string; type: string; targetFiles: string[] };
type AgentRunEvent =
  | { type: "status"; phase: "started" | "thinking"; label: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; toolCallId: string; toolName: string }
  | { type: "tool_completed"; toolCallId: string; toolName: string; failed: boolean }
  | { type: "awaiting_decision"; toolCallId: string; proposal: ProposalDecisionState }
  | { type: "completed" }
  | { type: "failed"; message: string };

type ApothecaryApi = {
  dashboard(): Promise<any>;
  chat(messages: ChatMessage[]): Promise<string>;
  startRun(runId: string, messages: ChatMessage[]): Promise<{ runId: string }>;
  resumeRun(
    runId: string,
    proposalId: string,
    decision: "approve" | "reject",
    note?: string,
  ): Promise<{ resolved: boolean; reason?: string }>;
  cancelRun(runId: string): Promise<{ canceled: boolean }>;
  onRunEvent(listener: (message: { runId: string; event: AgentRunEvent }) => void): () => void;
  changes(): Promise<any[]>;
  resolveChanges(ids: string[], outcome: "processed" | "dismissed"): Promise<number>;
  sync(): Promise<any>;
  inbox(): Promise<any[]>;
  readInbox(filePath: string): Promise<any>;
  readFile(filePath: string): Promise<any>;
  proposals(status?: "proposed" | "applied" | "rejected"): Promise<any[]>;
  resolveProposal(id: string, decision: "approve" | "reject", note?: string): Promise<any>;
  operations(): Promise<any[]>;
  knowledge(): Promise<any>;
  diagnostics(): Promise<any>;
};

interface Window {
  apothecary: ApothecaryApi;
}
