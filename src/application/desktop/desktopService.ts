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
import { loadCanonicalCandidates, loadRelations } from "../../vault/semanticStore.js";
import { buildMaintenanceFindings } from "../../domain/maintenanceFindings.js";
import { detectSupersededNotes } from "../maintenance/detectSupersededNotes.js";
import { runConnectionDiagnostics } from "./connectionDiagnostics.js";
import type { AgentRunEvent } from "./runEvents.js";

export type DesktopChatMessage = { role: "user" | "assistant"; content: string };

export type DesktopServiceDeps = {
  chat: (messages: DesktopChatMessage[]) => Promise<string>;
  streamChat?: (
    messages: DesktopChatMessage[],
    emit: (event: AgentRunEvent) => void,
  ) => Promise<void>;
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
    const sqlDir = path.join(this.projectRoot, "sql");
    await fs.mkdir(sqlDir, { recursive: true });
    await Promise.all([
      initChangeLog(`file:${path.join(sqlDir, "change-log.db")}`),
      initOperationLedger(`file:${path.join(sqlDir, "operations.db")}`),
    ]);
  }

  chat(messages: DesktopChatMessage[]): Promise<string> {
    if (messages.length === 0 || messages.at(-1)?.role !== "user") {
      throw new Error("chat_requires_user_message");
    }
    return this.deps.chat(messages.slice(-20));
  }

  streamChat(messages: DesktopChatMessage[], emit: (event: AgentRunEvent) => void): Promise<void> {
    if (messages.length === 0 || messages.at(-1)?.role !== "user") {
      throw new Error("chat_requires_user_message");
    }
    if (!this.deps.streamChat) {
      return this.deps.chat(messages.slice(-20)).then((text) => emit({ type: "text_delta", text }));
    }
    return this.deps.streamChat(messages.slice(-20), emit);
  }

  async dashboard() {
    const [changes, proposals, operations, profileState] = await Promise.all([
      listPendingChanges(),
      listProposals(this.vaultPath),
      listOperations({ limit: 8 }),
      loadProfileRefreshState(this.vaultPath),
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
      scopePath: "inbox",
      includeHash: false,
      ignore: VAULT_IGNORE_GLOBS,
    });
    return scan.files
      .filter(
        (file) =>
          (file.mediaType === "markdown" || file.extension === ".txt") &&
          path.posix.basename(file.path) !== "README.md",
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

  async readInboxFile(filePath: string) {
    if (!filePath.replaceAll("\\", "/").startsWith("inbox/")) throw new Error("not_an_inbox_file");
    return readVaultText(this.vaultPath, filePath);
  }

  readTextFile(filePath: string) {
    return readVaultText(this.vaultPath, filePath);
  }

  proposals(status?: "proposed" | "applied" | "rejected") {
    return listProposals(this.vaultPath, status ? { status } : {});
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
    const artifacts = getAgentArtifacts(this.vaultPath);
    const [profileState, relations, candidates, superseded] = await Promise.all([
      loadProfileRefreshState(this.vaultPath),
      loadRelations(this.vaultPath),
      loadCanonicalCandidates(this.vaultPath),
      detectSupersededNotes(this.vaultPath),
    ]);
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
    };
  }
}
