type ChatMessage = { role: "user" | "assistant"; content: string };
type DesktopSettingsView = {
  vaultPath: string;
  chatModel?: string;
  deepseekBaseUrl?: string;
  embeddingBaseUrl?: string;
  embeddingModel?: string;
  embeddingTimeoutMs?: number;
  watch?: boolean;
  autoIntake?: boolean;
  hasDeepseekKey: boolean;
  hasEmbeddingKey: boolean;
};
type SaveSettingsPatch = Partial<Omit<DesktopSettingsView, "hasDeepseekKey" | "hasEmbeddingKey">> & {
  deepseekApiKey?: string;
  embeddingApiKey?: string;
};
type ProposalDecisionState = { proposalId: string; title: string; type: string; targetFiles: string[] };
type AgentRunEvent =
  | { type: "status"; phase: "started" | "thinking"; label: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; toolCallId: string; toolName: string }
  | { type: "tool_completed"; toolCallId: string; toolName: string; failed: boolean }
  | { type: "awaiting_decision"; toolCallId: string; proposal: ProposalDecisionState }
  | { type: "awaiting_approval"; toolCallId: string; toolName: string }
  | { type: "completed" }
  | { type: "failed"; message: string };

type ApothecaryApi = {
  dashboard(): Promise<any>;
  chat(messages: ChatMessage[]): Promise<string>;
  startRun(runId: string, messages: ChatMessage[], threadId?: string): Promise<{ runId: string }>;
  resumeRun(
    runId: string,
    proposalId: string,
    decision: "approve" | "reject",
    note?: string,
  ): Promise<{ resolved: boolean; reason?: string }>;
  resolveApproval(runId: string, toolCallId: string, decision: "approve" | "decline"): Promise<{ resolved: boolean }>;
  cancelRun(runId: string): Promise<{ canceled: boolean }>;
  onRunEvent(listener: (message: { runId: string; event: AgentRunEvent }) => void): () => void;
  changes(): Promise<any[]>;
  resolveChanges(ids: string[], outcome: "processed" | "dismissed"): Promise<number>;
  sync(): Promise<any>;
  inbox(): Promise<any[]>;
  vaultTree(): Promise<{ directories: Array<{ path: string; fileCount: number; markdownCount: number; totalBytes: number }>; totalFiles: number; markdownFiles: number }>;
  vaultFolder(scopePath: string): Promise<any[]>;
  readInbox(filePath: string): Promise<any>;
  readFile(filePath: string): Promise<any>;
  proposals(status?: "proposed" | "applied" | "rejected"): Promise<any[]>;
  proposalDiff(id: string): Promise<{
    type: string; path?: string; pathChange?: { from: string; to: string };
    before?: string; after?: string; note?: string;
  }>;
  resolveProposal(id: string, decision: "approve" | "reject", note?: string): Promise<any>;
  notes(): Promise<Array<{ path: string; title: string }>>;
  operations(): Promise<any[]>;
  knowledge(): Promise<any>;
  diagnostics(): Promise<any>;
  getSettings(): Promise<DesktopSettingsView>;
  saveSettings(patch: SaveSettingsPatch): Promise<DesktopSettingsView>;
  chooseVault(): Promise<string | null>;
  relaunchApp(): Promise<void>;
  threads(): Promise<Array<{ id: string; title: string; createdAt: string; updatedAt: string; preview?: string }>>;
  threadMessages(threadId: string): Promise<ChatMessage[]>;
  createThread(threadId: string, title?: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
};

interface Window {
  apothecary: ApothecaryApi;
}
