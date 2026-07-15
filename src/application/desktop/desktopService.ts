import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { initChangeLog, listPendingChanges, listRecentChanges, resolveChanges } from "../../vault/changeLog.js";
import { initOperationLedger, listOperations } from "../../vault/operationLedger.js";
import { buildRecentActivity, type RecentActivityItem } from "./recentActivity.js";
import { listProposals, loadProposal } from "../../vault/proposalStore.js";
import { resolveProposalById } from "../proposals/resolveProposal.js";
import { manualSync } from "../sync/manualSync.js";
import { scanVault } from "../../vault/scanner.js";
import { VAULT_IGNORE_GLOBS } from "../../domain/vaultPolicy.js";
import { readVaultText } from "../../vault/readText.js";
import { getAgentArtifacts } from "../../artifacts/agentArtifacts.js";
import { KnowledgeProfileSchema } from "../../domain/knowledgeProfile.js";
import { loadProfileRefreshState } from "../../vault/profileState.js";
import { loadCanonicalCandidates, loadGraph, loadRelations } from "../../vault/semanticStore.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";
import { apothecaryDb } from "../../config/apothecaryDb.js";
import { buildMaintenanceFindings } from "../../domain/maintenanceFindings.js";
import { detectSupersededNotes } from "../maintenance/detectSupersededNotes.js";
import { runConnectionDiagnostics } from "./connectionDiagnostics.js";
import type { AgentRunEvent } from "./runEvents.js";
import { buildQuickAskPrompt, type QuickAskTurn } from "./quickAskPrompt.js";
import type { PolishMode } from "../../domain/notePolish.js";
import { fileTargetPath, type IntakeDecision } from "../../domain/intakePlan.js";

// The frozen vault skeleton names the intake folder `_inbox` (see
// classifyLayer / inboxSurvey). The desktop service scopes and guards on it.
const INBOX_DIR = "_inbox";

// Meta files that describe a folder rather than being triageable content:
// `README.md` directory indexes and `_inbox/ABOUT.md` entry notes (see the
// organizer agent). They stay in place and are hidden from the file lists.
const META_FILENAMES = new Set(["readme.md", "about.md"]);
const isMetaFile = (relativePath: string): boolean =>
  META_FILENAMES.has(path.posix.basename(relativePath).toLowerCase());

export type DesktopChatMessage = { role: "user" | "assistant"; content: string };

/** A persisted conversation, backed by one Mastra memory thread. */
export type DesktopThread = { id: string; title: string; createdAt: string; updatedAt: string; preview?: string };

/**
 * A quick-ask (划词快问): one side-channel question about selected text. Carries
 * its own bounded context; deliberately has no threadId so it can never touch
 * conversation memory.
 */
export type QuickAskRequest = {
  runId: string;
  question: string;
  selection: string;
  contextText: string;
  source: "chat" | "note";
  sourcePath?: string;
  priorTurns: QuickAskTurn[];
};

/** Human decision injected back into a suspended `proposeChange` tool call. */
export type ProposalResumeData = {
  proposalId: string;
  decision: "applied" | "rejected" | "failed";
  note?: string;
};

export type DesktopServiceDeps = {
  // `threadId` scopes the turn to a persisted conversation (Mastra memory thread).
  chat: (messages: DesktopChatMessage[], threadId?: string) => Promise<string>;
  streamChat?: (
    messages: DesktopChatMessage[],
    emit: (event: AgentRunEvent) => void,
    runId: string,
    threadId?: string,
  ) => Promise<void>;
  resumeRun?: (
    runId: string,
    resumeData: ProposalResumeData,
    emit: (event: AgentRunEvent) => void,
  ) => Promise<void>;
  // Native Mastra tool approval (requireApproval tools like executeIntake):
  // approve or decline the paused tool call, then resume the run in-context.
  approveToolCall?: (
    runId: string,
    toolCallId: string,
    decision: "approve" | "decline",
    emit: (event: AgentRunEvent) => void,
  ) => Promise<void>;
  cancelRun?: (runId: string) => boolean;
  // Isolation invariant: the implementation must be a one-shot, tool-less call
  // with NO memory option — a quick ask never persists to any thread.
  quickAsk?: (prompt: string, emit: (event: AgentRunEvent) => void, runId: string) => Promise<void>;
  // Note polishing needs the LLM adapter, so the composition root injects it
  // (same reason as chat: this service must not import mastra).
  polishNote?: (
    filePath: string,
    modes: PolishMode[],
  ) => Promise<{ proposalId: string; changeSummary: string }>;
  // Conversation history, backed by Mastra memory threads.
  listThreads?: () => Promise<DesktopThread[]>;
  threadMessages?: (threadId: string) => Promise<DesktopChatMessage[]>;
  createThread?: (threadId: string, title?: string) => Promise<void>;
  deleteThread?: (threadId: string) => Promise<void>;
};

export class DesktopService {
  readonly vaultPath: string;
  readonly projectRoot: string;
  private readonly deps: DesktopServiceDeps;

  constructor(input: { vaultPath: string; projectRoot: string; deps: DesktopServiceDeps }) {
    this.vaultPath = path.resolve(input.vaultPath);
    this.projectRoot = path.resolve(input.projectRoot);
    this.deps = input.deps;
  }

  async initialize(): Promise<void> {
    // Ledgers live in the global agent home (apothecaryDb ensures their dirs).
    await Promise.all([
      initChangeLog(apothecaryDb.changeLog()),
      initOperationLedger(apothecaryDb.operations()),
    ]);
  }

  chat(messages: DesktopChatMessage[], threadId?: string): Promise<string> {
    if (messages.length === 0 || messages.at(-1)?.role !== "user") {
      throw new Error("chat_requires_user_message");
    }
    return this.deps.chat(messages.slice(-20), threadId);
  }

  streamChat(messages: DesktopChatMessage[], emit: (event: AgentRunEvent) => void, runId: string, threadId?: string): Promise<void> {
    if (messages.length === 0 || messages.at(-1)?.role !== "user") {
      throw new Error("chat_requires_user_message");
    }
    if (!this.deps.streamChat) {
      return this.deps
        .chat(messages.slice(-20), threadId)
        .then((text) => {
          emit({ type: "text_delta", text });
          emit({ type: "completed" });
        });
    }
    return this.deps.streamChat(messages.slice(-20), emit, runId, threadId);
  }

  /** One-shot side-channel Q&A about selected text; isolated from all threads. */
  quickAsk(request: QuickAskRequest, emit: (event: AgentRunEvent) => void): Promise<void> {
    if (!this.deps.quickAsk) throw new Error("quick_ask_not_available");
    const sourceLabel = request.source === "note"
      ? `vault note ${request.sourcePath ?? "(unknown)"}`
      : "a chat reply from the assistant";
    const prompt = buildQuickAskPrompt({
      question: request.question,
      selection: request.selection,
      contextText: request.contextText,
      sourceLabel,
      priorTurns: request.priorTurns,
    });
    return this.deps.quickAsk(prompt, emit, request.runId);
  }

  /** List persisted conversations (Mastra memory threads), newest first. */
  threads(): Promise<DesktopThread[]> {
    return this.deps.listThreads?.() ?? Promise.resolve([]);
  }

  /** Load a conversation's user/assistant messages for replay in the timeline. */
  threadMessages(threadId: string): Promise<DesktopChatMessage[]> {
    return this.deps.threadMessages?.(threadId) ?? Promise.resolve([]);
  }

  createThread(threadId: string, title?: string): Promise<void> {
    return this.deps.createThread?.(threadId, title) ?? Promise.resolve();
  }

  deleteThread(threadId: string): Promise<void> {
    return this.deps.deleteThread?.(threadId) ?? Promise.resolve();
  }

  /**
   * Apply the human decision to a proposal created during a suspended run, then
   * resume that run in-context so the agent can continue. Approvals go through the
   * durable resolveProposal path (path safety, ledger, recovery) before the run
   * learns the outcome; rejections and apply failures resume too, so the run never
   * stays stuck. Resuming re-emits the continued agent events onto the same runId.
   */
  async resumeRun(
    runId: string,
    proposalId: string,
    decision: "approve" | "reject",
    emit: (event: AgentRunEvent) => void,
    note?: string,
  ): Promise<{ resolved: boolean; reason?: string }> {
    if (decision === "reject") {
      const result = await resolveProposalById(proposalId, "reject", note);
      await this.deps.resumeRun?.(runId, { proposalId, decision: "rejected", note }, emit);
      return result;
    }

    const result = await resolveProposalById(proposalId, "approve", note);
    const resumeData: ProposalResumeData = result.resolved
      ? { proposalId, decision: "applied", note }
      : { proposalId, decision: "failed", note: result.reason };
    await this.deps.resumeRun?.(runId, resumeData, emit);
    return result;
  }

  /**
   * Resolve a native tool-approval gate (e.g. executeIntake's `requireApproval`).
   * Approving runs the tool and resumes the run; declining resumes with the tool
   * skipped. Either way the continued agent output streams back over the runId.
   */
  async resolveApproval(
    runId: string,
    toolCallId: string,
    decision: "approve" | "decline",
    emit: (event: AgentRunEvent) => void,
  ): Promise<{ resolved: boolean }> {
    await this.deps.approveToolCall?.(runId, toolCallId, decision, emit);
    return { resolved: true };
  }

  cancelRun(runId: string): boolean {
    return this.deps.cancelRun?.(runId) ?? false;
  }

  async dashboard() {
    const [changes, proposals, operations, profileState] = await Promise.all([
      listPendingChanges(),
      listProposals(apothecaryHome()),
      listOperations({ limit: 8 }),
      loadProfileRefreshState(apothecaryHome()),
    ]);
    return {
      vaultPath: this.vaultPath,
      pendingChanges: changes.length,
      pendingProposals: proposals.filter((proposal) => proposal.status === "proposed").length,
      recentOperations: operations,
      profileStale: profileState.dirty,
      // Live env, same source the watcher checks — the sidebar shows a standing
      // reminder whenever unattended inbox planning is armed.
      autoIntakeActive: process.env.APOTHECARY_AUTO_INTAKE === "1",
    };
  }

  changes() {
    return listPendingChanges();
  }

  resolveChanges(ids: string[], outcome: "processed" | "dismissed") {
    return resolveChanges(ids, outcome);
  }

  sync() {
    return manualSync({ vaultPath: this.vaultPath });
  }

  async inbox() {
    const scan = await scanVault({
      vaultPath: this.vaultPath,
      scopePath: INBOX_DIR,
      includeHash: false,
      ignore: VAULT_IGNORE_GLOBS,
    });
    return scan.files
      .filter(
        (file) =>
          (file.mediaType === "markdown" || file.extension === ".txt") &&
          !isMetaFile(file.path),
      )
      .map((file) => ({
        path: file.path,
        mediaType: file.mediaType,
        title: file.title,
        excerpt: file.excerpt,
        updatedAt: file.updatedAt,
        sizeBytes: file.sizeBytes,
      }));
  }

  /** Top-level PARA folders with counts, for the Vault navigation tree. */
  async vaultTree() {
    const scan = await scanVault({
      vaultPath: this.vaultPath,
      includeHash: false,
      ignore: VAULT_IGNORE_GLOBS,
    });
    return {
      directories: scan.stats.topLevelDirectories,
      totalFiles: scan.stats.totalFiles,
      markdownFiles: scan.stats.markdownFiles,
    };
  }

  /** Markdown/txt files inside a folder scope, for the Vault file list. */
  async vaultFolder(scopePath: string) {
    const scan = await scanVault({
      vaultPath: this.vaultPath,
      scopePath,
      includeHash: false,
      ignore: VAULT_IGNORE_GLOBS,
    });
    return scan.files
      .filter(
        (file) =>
          (file.mediaType === "markdown" || file.extension === ".txt") &&
          !isMetaFile(file.path),
      )
      .map((file) => ({
        path: file.path,
        mediaType: file.mediaType,
        title: file.title,
        updatedAt: file.updatedAt,
        sizeBytes: file.sizeBytes,
      }));
  }

  async readInboxFile(filePath: string) {
    if (!filePath.replaceAll("\\", "/").startsWith(`${INBOX_DIR}/`)) throw new Error("not_an_inbox_file");
    return readVaultText(this.vaultPath, filePath);
  }

  readTextFile(filePath: string) {
    return readVaultText(this.vaultPath, filePath);
  }

  proposals(status?: "proposed" | "applied" | "rejected") {
    return listProposals(apothecaryHome(), status ? { status } : {});
  }

  resolveProposal(id: string, decision: "approve" | "reject", note?: string) {
    return resolveProposalById(id, decision, note);
  }

  /** Polish one note into an `edit` proposal; the note itself is never written here. */
  polishNote(filePath: string, modes: PolishMode[]): Promise<{ proposalId: string; changeSummary: string }> {
    if (!this.deps.polishNote) throw new Error("polish_not_available");
    return this.deps.polishNote(filePath, modes);
  }

  /**
   * A presentation-ready diff for a proposal: a path change and/or before→after
   * content, derived per proposal type from its payload. `before` is the current
   * on-disk content (empty for a new file); the renderer turns before/after into
   * a line diff. Reading is best-effort so a missing target never breaks the view.
   */
  async proposalDiff(id: string): Promise<{
    type: string; path?: string; pathChange?: { from: string; to: string };
    before?: string; after?: string; note?: string;
  }> {
    const proposal = await loadProposal(apothecaryHome(), id);
    if (!proposal) return { type: "unknown" };
    const readSafe = async (relativePath?: string): Promise<string | undefined> => {
      if (!relativePath) return undefined;
      try { return (await readVaultText(this.vaultPath, relativePath)).content; } catch { return undefined; }
    };
    const payload = proposal.payload as any;
    switch (proposal.type) {
      case "move":
        return { type: "move", pathChange: { from: payload.from, to: payload.to } };
      case "archive":
        return { type: "archive", pathChange: { from: payload.from, to: "archive/" }, note: "移入归档区" };
      case "edit":
        return { type: "edit", path: payload.filePath, before: await readSafe(payload.filePath), after: payload.suggestedContent };
      case "capture":
        return { type: "capture", after: payload.content, note: payload.topic ? `主题提示：${payload.topic}` : "归位目标在应用时分类" };
      case "merge":
        return { type: "merge", pathChange: { from: payload.sourcePath, to: payload.canonicalPath }, before: await readSafe(payload.canonicalPath), after: payload.canonicalContent, note: "合并后源笔记归档" };
      case "view_promotion":
        return { type: "view_promotion", pathChange: { from: payload.sourceViewPath, to: payload.targetPath }, after: payload.content };
      case "canonical_note":
        return { type: "canonical_note", path: payload.canonicalPath, before: await readSafe(payload.canonicalPath), after: payload.content, note: payload.supersedes?.length ? `将取代：${payload.supersedes.join("、")}` : undefined };
      case "structure": {
        const parts = [payload.add?.length ? `新增关键词：${payload.add.join("、")}` : "", payload.remove?.length ? `移除关键词：${payload.remove.join("、")}` : ""].filter(Boolean);
        return { type: "structure", path: payload.directory, note: parts.join("；") || "调整目录分类关键词" };
      }
      case "intake": {
        // One line per decision; the renderer shows the note pre-line.
        const lines = (payload.decisions as IntakeDecision[]).map((d) => {
          if (d.action === "archive") return `归档 ${d.source}`;
          if (d.action === "leave") return `保留 ${d.source}（${d.rationale}）`;
          return d.kind === "directory"
            ? `迁移 ${d.source}/* → ${d.dest ?? ""}`
            : `迁移 ${d.source} → ${fileTargetPath(d)}`;
        });
        return { type: "intake", note: lines.join("\n") };
      }
      default:
        return { type: "unknown" };
    }
  }

  /** Flat list of vault notes (path + title) for the composer's @-mention picker. */
  async notes(): Promise<Array<{ path: string; title: string }>> {
    const scan = await scanVault({ vaultPath: this.vaultPath, includeHash: false, ignore: VAULT_IGNORE_GLOBS });
    return scan.files
      .filter((file) => file.mediaType === "markdown" && !isMetaFile(file.path))
      .map((file) => ({ path: file.path, title: file.title || path.posix.basename(file.path) }));
  }

  operations(limit = 50) {
    return listOperations({ limit });
  }

  /**
   * The merged "what happened recently" timeline: manual vault edits (change
   * ledger, all triage states) and the agent's own applied operations, newest
   * first. Backs the Vault view's 最近 pseudo-folder.
   */
  async recentActivity(days = 7): Promise<RecentActivityItem[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const [changes, operations] = await Promise.all([
      listRecentChanges({ since }),
      listOperations({ since, limit: 200 }),
    ]);
    return buildRecentActivity(changes, operations);
  }

  async diagnostics() {
    const services = await runConnectionDiagnostics();
    let vaultStatus: "read_write" | "read_only" | "unavailable" = "unavailable";
    try {
      await fs.access(this.vaultPath, fsConstants.R_OK | fsConstants.W_OK);
      vaultStatus = "read_write";
    } catch {
      try {
        await fs.access(this.vaultPath, fsConstants.R_OK);
        vaultStatus = "read_only";
      } catch {
        vaultStatus = "unavailable";
      }
    }
    return { ...services, vault: { path: this.vaultPath, status: vaultStatus } };
  }

  async knowledge() {
    const artifacts = getAgentArtifacts();
    const [profileState, relations, candidates, superseded, graph] = await Promise.all([
      loadProfileRefreshState(apothecaryHome()),
      loadRelations(apothecaryHome()),
      loadCanonicalCandidates(apothecaryHome()),
      detectSupersededNotes(this.vaultPath),
      loadGraph(apothecaryHome()).catch(() => ({ topics: [], concepts: [] })),
    ]);
    // Top topic domains (label + member files), most-covered first, for the
    // Knowledge view's domain cards and node graph.
    const topics = [...graph.topics]
      .sort((a, b) => b.files.length - a.files.length)
      .slice(0, 8);
    let profile: unknown = null;
    try {
      profile = KnowledgeProfileSchema.parse(
        JSON.parse(await fs.readFile(path.join(artifacts.profileDir, "knowledge-profile.json"), "utf8")),
      );
    } catch {
      profile = null;
    }
    return {
      profile,
      profileStale: profileState.dirty,
      relationCount: relations.relations.length,
      canonicalCandidates: candidates.candidates,
      maintenanceFindings: buildMaintenanceFindings({ superseded, candidates: candidates.candidates }),
      topics,
    };
  }
}
