type ChatMessage = { role: "user" | "assistant"; content: string };
type DesktopSettingsView = {
  vaultPath: string;
  chatModel?: string;
  deepseekBaseUrl?: string;
  embeddingBaseUrl?: string;
  embeddingModel?: string;
  embeddingTimeoutMs?: number;
  watch?: boolean;
  autoIntakePlanning?: boolean;
  hasDeepseekKey: boolean;
  hasEmbeddingKey: boolean;
};
type SaveSettingsPatch = Partial<Omit<DesktopSettingsView, "hasDeepseekKey" | "hasEmbeddingKey">> & {
  deepseekApiKey?: string;
  embeddingApiKey?: string;
};
type ProposalDecisionState = { proposalId: string; title: string; type: string; targetFiles: string[] };
type RecentActivityItem = {
  id: string;
  kind: string;
  actor: "user" | "agent";
  path: string;
  fromPath?: string;
  at: string;
  detail?: string;
};
type QuickAskRequest = {
  runId: string;
  question: string;
  selection: string;
  contextText: string;
  source: "chat" | "note";
  sourcePath?: string;
  priorTurns: Array<{ question: string; answer: string }>;
};
type AgentRunEvent =
  | { type: "status"; phase: "started" | "thinking"; label: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; toolCallId: string; toolName: string }
  | { type: "tool_completed"; toolCallId: string; toolName: string; failed: boolean }
  | { type: "awaiting_decision"; toolCallId: string; proposal: ProposalDecisionState }
  | { type: "awaiting_approval"; toolCallId: string; toolName: string }
  | { type: "completed" }
  | { type: "failed"; message: string };

type JournalCadence = "daily" | "weekly" | "monthly" | "yearly";
type JournalPlanItem = { line: number; time?: string; endTime?: string; title: string; done: boolean; raw: string };
type JournalPeriodNote = {
  cadence: JournalCadence;
  key: string;
  relPath: string;
  exists: boolean;
  items: JournalPlanItem[];
  reviewFilled: boolean;
  content: string | null;
};
type JournalPeriodView = JournalPeriodNote & {
  title: string;
  range: { start: string; end: string };
  prevKey: string;
  nextKey: string;
  currentKey: string;
};
type JournalPlanTarget =
  | { kind: "period"; cadence: JournalCadence; key: string }
  | { kind: "template"; cadence: JournalCadence };
type NavigationTarget = { view: "journal"; cadence: JournalCadence; key: string };

type ApothecaryApi = {
  dashboard(): Promise<any>;
  chat(messages: ChatMessage[]): Promise<string>;
  startRun(runId: string, messages: ChatMessage[], threadId?: string): Promise<{ runId: string }>;
  quickAsk(input: QuickAskRequest): Promise<{ runId: string }>;
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
  polishNote(
    filePath: string,
    modes: Array<"expand" | "format" | "tags">,
  ): Promise<{ proposalId: string; changeSummary: string }>;
  notes(): Promise<Array<{ path: string; title: string }>>;
  operations(): Promise<any[]>;
  recentActivity(days?: number): Promise<RecentActivityItem[]>;
  knowledge(): Promise<any>;
  diagnostics(): Promise<any>;
  getSettings(): Promise<DesktopSettingsView>;
  saveSettings(patch: SaveSettingsPatch): Promise<DesktopSettingsView>;
  chooseVault(): Promise<string | null>;
  relaunchApp(): Promise<void>;
  journalRead(cadence: JournalCadence, key?: string): Promise<JournalPeriodView>;
  journalInstantiate(cadence: JournalCadence, key: string): Promise<{ created: boolean; note: JournalPeriodNote }>;
  journalToggle(cadence: JournalCadence, key: string, line: number, raw?: string): Promise<JournalPeriodNote>;
  journalAddPlan(
    target: JournalPlanTarget,
    item: { title: string; time?: string; endTime?: string },
  ): Promise<{ relPath: string; note?: JournalPeriodNote }>;
  journalOpenEditor(relPath: string): Promise<boolean>;
  onNavigate(listener: (target: NavigationTarget) => void): () => void;
  pendingNavigation(): Promise<NavigationTarget | null>;
  threads(): Promise<Array<{ id: string; title: string; createdAt: string; updatedAt: string; preview?: string }>>;
  threadMessages(threadId: string): Promise<ChatMessage[]>;
  createThread(threadId: string, title?: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
};

interface Window {
  apothecary: ApothecaryApi;
}
