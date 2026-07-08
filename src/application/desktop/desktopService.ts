import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { initChangeLog, listPendingChanges, resolveChanges } from "../../vault/changeLog.js";
import { initOperationLedger, listOperations } from "../../vault/operationLedger.js";
import { listProposals } from "../../vault/proposalStore.js";
import { resolveProposalById } from "../../mastra/tools/resolve-proposal-core.js";
import { manualSync } from "../../mastra/tools/manual-sync-core.js";
import { scanVault } from "../../vault/scanner.js";
import { VAULT_IGNORE_GLOBS } from "../../vault/ignore.js";
import { readVaultText } from "../../mastra/tools/read-vault-text.js";
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
export type DesktopThread = { id: string; title: string; createdAt: string; updatedAt: string };

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
  cancelRun?: (runId: string) => boolean;
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

  operations(limit = 50) {
    return listOperations({ limit });
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
