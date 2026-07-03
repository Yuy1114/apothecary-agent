import { promises as fs } from "node:fs";
import path from "node:path";
import { reindexFile } from "./rag.js";
import { moveVaultFileCore } from "./move-vault-file-core.js";
import { archiveVaultFileCore } from "./archive-vault-file-core.js";
import { mergeNotesCore } from "./merge-notes-core.js";
import { writeVaultNote } from "./ingest-core.js";
import { updateDirectoryKeywords } from "./vault-structure.js";
import { recordOperation } from "../../vault/operationLedger.js";
import { safeVaultPath } from "../../safety/pathSafety.js";
import { loadProposal, saveProposal, listProposals } from "../../vault/proposalStore.js";
import { resolveProposalRecord, type Proposal } from "../../domain/proposal.js";
import { nowIso } from "../../utils/time.js";
import { syncSemanticsForPaths } from "../../application/semantic/syncSemanticsFromChanges.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

/**
 * Post-apply consistency hook: refresh the semantic layer for the changed files.
 * Injectable so tests can stub the LLM-backed refresh.
 */
type PostApplyRefresh = (vaultPath: string, paths: string[]) => Promise<unknown>;
const defaultPostApplyRefresh: PostApplyRefresh = (vaultPath, paths) =>
  syncSemanticsForPaths({ vaultPath, paths });

export type ResolveProposalResult = {
  resolved: boolean;
  proposalId: string;
  type?: Proposal["type"];
  status?: Proposal["status"];
  /** Why a resolution could not proceed. */
  reason?: string;
};

/**
 * Execute a proposal's payload by dispatching to the existing action cores.
 * Returns whether the underlying executor succeeded; the proposal is only marked
 * applied when it did. The cores each record their own operation-ledger entry
 * (merge records a `merge` op, etc.), so applying stays fully audited.
 */
async function executeProposal(
  proposal: Proposal,
): Promise<{ ok: boolean; reason?: string; affected?: string[] }> {
  switch (proposal.type) {
    case "edit": {
      const { filePath, suggestedContent } = proposal.payload;
      const abs = safeVaultPath(VAULT_PATH, filePath);
      if (!abs) return { ok: false, reason: "unsafe_path" };
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, suggestedContent, "utf8");
      if (filePath.endsWith(".md")) await reindexFile(filePath);
      await recordOperation({
        type: "edit",
        targetFiles: [filePath],
        rationale: proposal.title,
        source: "resolveProposal",
        detail: proposal.rationale,
      });
      return { ok: true, affected: [filePath] };
    }
    case "move": {
      const r = await moveVaultFileCore(proposal.payload.from, proposal.payload.to);
      return r.moved
        ? { ok: true, affected: [proposal.payload.from, proposal.payload.to] }
        : { ok: false, reason: r.reason };
    }
    case "archive": {
      const r = await archiveVaultFileCore(proposal.payload.from, { reason: proposal.rationale });
      return r.archived
        ? { ok: true, affected: [proposal.payload.from] }
        : { ok: false, reason: r.reason };
    }
    case "merge": {
      const r = await mergeNotesCore({ ...proposal.payload, reason: proposal.rationale });
      return r.merged
        ? { ok: true, affected: [proposal.payload.sourcePath, proposal.payload.canonicalPath] }
        : { ok: false, reason: r.reason };
    }
    case "capture": {
      // writeVaultNote classifies, writes frontmatter'd note, updates the
      // directory README, reindexes and records a `capture` op.
      const captured = await writeVaultNote({
        content: proposal.payload.content,
        topic: proposal.payload.topic,
        noteType: "insight",
        source: "conversation",
        operationType: "capture",
      });
      return { ok: true, affected: [captured.filePath] };
    }
    case "structure": {
      // updateDirectoryKeywords validates the directory exists (throws otherwise)
      // and records a `structure` op.
      await updateDirectoryKeywords({
        directory: proposal.payload.directory,
        add: proposal.payload.add,
        remove: proposal.payload.remove,
      });
      return { ok: true, affected: [] };
    }
    case "view_promotion": {
      const { sourceViewPath, targetPath, content } = proposal.payload;
      const sourceAbs = safeVaultPath(VAULT_PATH, sourceViewPath);
      const abs = safeVaultPath(VAULT_PATH, targetPath);
      if (!sourceAbs || !abs) return { ok: false, reason: "unsafe_path" };
      try {
        await fs.access(sourceAbs);
      } catch {
        return { ok: false, reason: "missing_source_view" };
      }
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf8");
      if (targetPath.endsWith(".md")) await reindexFile(targetPath);
      await recordOperation({
        type: "promote",
        targetFiles: [sourceViewPath, targetPath],
        rationale: proposal.title,
        source: "resolveProposal",
        detail: `promoted ${sourceViewPath} → ${targetPath}`,
      });
      return { ok: true, affected: [targetPath] };
    }
  }
}

/**
 * Resolve a proposal: `approve` executes it (marking it applied only on success)
 * and `reject` records the decision without touching any file. Either way the
 * proposal record captures the governance outcome (status + resolvedAt + note).
 */
export async function resolveProposalById(
  id: string,
  decision: "approve" | "reject",
  note?: string,
  deps: { postApplyRefresh: PostApplyRefresh } = { postApplyRefresh: defaultPostApplyRefresh },
): Promise<ResolveProposalResult> {
  const proposal = await loadProposal(VAULT_PATH, id);
  if (!proposal) return { resolved: false, proposalId: id, reason: "not_found" };
  if (proposal.status !== "proposed") {
    return { resolved: false, proposalId: id, type: proposal.type, status: proposal.status, reason: "not_pending" };
  }

  if (decision === "reject") {
    const rejected = resolveProposalRecord(proposal, "rejected", note, nowIso());
    await saveProposal(VAULT_PATH, rejected);
    return { resolved: true, proposalId: id, type: proposal.type, status: "rejected" };
  }

  // Executors report expected failures via {ok:false}; some (e.g. structure)
  // throw on invalid input. Either way, leave the proposal open to fix and retry.
  let outcome: { ok: boolean; reason?: string; affected?: string[] };
  try {
    outcome = await executeProposal(proposal);
  } catch (error) {
    return {
      resolved: false,
      proposalId: id,
      type: proposal.type,
      reason: error instanceof Error ? error.message : "apply_failed",
    };
  }
  if (!outcome.ok) {
    return { resolved: false, proposalId: id, type: proposal.type, reason: outcome.reason ?? "apply_failed" };
  }

  // Bring the semantic layer in step with the change before the proposal counts
  // as applied. Best-effort: the file change already succeeded, so a refresh
  // failure must not block `applied` (the watcher debounce is the fallback).
  try {
    await deps.postApplyRefresh(VAULT_PATH, outcome.affected ?? []);
  } catch (error) {
    console.warn(`resolveProposal: post-apply semantic refresh failed for ${id}:`, error);
  }

  const applied = resolveProposalRecord(proposal, "applied", note, nowIso());
  await saveProposal(VAULT_PATH, applied);
  return { resolved: true, proposalId: id, type: proposal.type, status: "applied" };
}

/** Read-only listing for the tool layer. */
export function listProposalRecords(
  filter: Parameters<typeof listProposals>[1] = {},
): Promise<Proposal[]> {
  return listProposals(VAULT_PATH, filter);
}
