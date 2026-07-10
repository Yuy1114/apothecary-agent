import { promises as fs } from "node:fs";
import path from "node:path";
import { searchIndex } from "../ports/searchIndex.js";
import { moveVaultFileCore } from "../notes/moveVaultFile.js";
import { archiveVaultFileCore } from "../notes/archiveVaultFile.js";
import { mergeNotesCore } from "../notes/mergeNotes.js";
import { writeVaultNote } from "../intake/ingestNote.js";
import { updateDirectoryKeywords } from "../../vault/structureStore.js";
import { recordOperation } from "../../vault/operationLedger.js";
import { resolvePendingByPaths } from "../../vault/changeLog.js";
import { markSelfWrite } from "../../vault/selfWriteGuard.js";
import { commitSelfWrite } from "../../vault/syncSnapshot.js";
import { safeVaultPath } from "../../safety/pathSafety.js";
import { setFrontmatterKey } from "../../vault/frontmatter.js";
import { loadProposal, saveProposal, listProposals } from "../../vault/proposalStore.js";
import { getAgentArtifacts } from "../../artifacts/agentArtifacts.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";
import { resolveProposalRecord, type Proposal } from "../../domain/proposal.js";
import { nowIso } from "../../utils/time.js";
import { syncSemanticsForPaths } from "../semantic/syncSemanticsFromChanges.js";
import { updateReadmeForCreatedNote } from "../notes/updateReadmes.js";
import { enqueueSemanticRecovery } from "../semantic/semanticRecovery.js";

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
      const existed = await fs.access(abs).then(() => true, () => false);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, suggestedContent, "utf8");
      if (filePath.endsWith(".md")) await searchIndex().reindexFile(filePath);
      if (!existed) await updateReadmeForCreatedNote(VAULT_PATH, filePath);
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
      if (targetPath.replaceAll("\\", "/").startsWith(".agent/")) {
        return { ok: false, reason: "invalid_promotion_target" };
      }
      // Generated views live in the global agent home (~/.apothecary/views), so
      // the source view is resolved there; the promotion target is a vault note.
      const artifacts = getAgentArtifacts();
      const sourceAbs = path.resolve(artifacts.rootPath, sourceViewPath);
      const abs = safeVaultPath(VAULT_PATH, targetPath);
      if (!abs) return { ok: false, reason: "unsafe_path" };
      const viewsRoot = artifacts.viewsDir;
      const sourceWithinViews = path.relative(viewsRoot, sourceAbs);
      if (
        sourceWithinViews === "" ||
        sourceWithinViews.startsWith("..") ||
        path.isAbsolute(sourceWithinViews)
      ) {
        return { ok: false, reason: "invalid_source_view" };
      }
      try {
        await fs.access(sourceAbs);
      } catch {
        return { ok: false, reason: "missing_source_view" };
      }
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf8");
      if (targetPath.endsWith(".md")) await searchIndex().reindexFile(targetPath);
      await updateReadmeForCreatedNote(VAULT_PATH, targetPath);
      await recordOperation({
        type: "promote",
        targetFiles: [sourceViewPath, targetPath],
        rationale: proposal.title,
        source: "resolveProposal",
        detail: `promoted ${sourceViewPath} → ${targetPath}`,
      });
      return { ok: true, affected: [targetPath] };
    }
    case "canonical_note": {
      const { canonicalPath, content, supersedes } = proposal.payload;
      if (canonicalPath.replaceAll("\\", "/").startsWith(".agent/")) {
        return { ok: false, reason: "invalid_canonical_target" };
      }
      const canonicalAbs = safeVaultPath(VAULT_PATH, canonicalPath);
      if (!canonicalAbs) return { ok: false, reason: "unsafe_path" };
      for (const source of supersedes) {
        if (!safeVaultPath(VAULT_PATH, source)) return { ok: false, reason: "unsafe_path" };
      }

      // Write/update the canonical note.
      const canonicalExisted = await fs.access(canonicalAbs).then(() => true, () => false);
      await fs.mkdir(path.dirname(canonicalAbs), { recursive: true });
      await fs.writeFile(canonicalAbs, content, "utf8");
      if (canonicalPath.endsWith(".md")) await searchIndex().reindexFile(canonicalPath);
      if (!canonicalExisted) await updateReadmeForCreatedNote(VAULT_PATH, canonicalPath);

      // Stamp a directed `superseded_by` link into each source that still exists
      // (human-visible, and survives semantic refreshes). Missing ones are skipped.
      const stamped: string[] = [];
      for (const source of supersedes) {
        if (source === canonicalPath) continue;
        const sourceAbs = safeVaultPath(VAULT_PATH, source);
        if (!sourceAbs) continue;
        let sourceContent: string;
        try {
          sourceContent = await fs.readFile(sourceAbs, "utf8");
        } catch {
          continue;
        }
        await fs.writeFile(sourceAbs, setFrontmatterKey(sourceContent, "superseded_by", canonicalPath), "utf8");
        if (source.endsWith(".md")) await searchIndex().reindexFile(source);
        stamped.push(source);
      }

      await recordOperation({
        type: "canonical",
        targetFiles: [canonicalPath, ...stamped],
        rationale: proposal.title,
        source: "resolveProposal",
        detail: stamped.length
          ? `canonical ${canonicalPath}; supersedes ${stamped.join(", ")}`
          : `canonical ${canonicalPath}`,
      });
      return { ok: true, affected: [canonicalPath, ...stamped] };
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
  const proposal = await loadProposal(apothecaryHome(), id);
  if (!proposal) return { resolved: false, proposalId: id, reason: "not_found" };
  if (proposal.status !== "proposed") {
    return { resolved: false, proposalId: id, type: proposal.type, status: proposal.status, reason: "not_pending" };
  }

  if (decision === "reject") {
    const rejected = resolveProposalRecord(proposal, "rejected", note, nowIso());
    await saveProposal(apothecaryHome(), rejected);
    return { resolved: true, proposalId: id, type: proposal.type, status: "rejected" };
  }

  // Mark the paths this apply will touch before writing, so the vault watcher
  // treats the resulting fs events as the agent's own work and does not re-queue
  // them as external changes. Marked again below with the exact affected set once
  // known (README side-effects mark themselves inside the readme-index core).
  markSelfWrite(proposal.targetFiles);

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

  // Re-mark with the exact affected paths (covers move's destination, etc.) now
  // that the write has landed, refreshing the window for late fs.watch events.
  markSelfWrite(outcome.affected ?? []);

  // Fold the applied write into the change baseline (sources dropped, targets
  // hashed) and release the marks, so neither the watcher nor a later manual
  // sync re-flags this agent-applied change as an external edit.
  try {
    await commitSelfWrite(VAULT_PATH, outcome.affected ?? []);
  } catch (error) {
    console.warn(`resolveProposal: failed to update change baseline for ${id}:`, error);
  }

  // The agent handled these paths, so clear any change queued for them earlier
  // (e.g. a file manual sync flagged before this proposal applied) so it doesn't
  // linger as a stale pending item.
  await resolvePendingByPaths(outcome.affected ?? []);

  // Bring the semantic layer in step with the change before the proposal counts
  // as applied. Best-effort: the file change already succeeded, so a refresh
  // failure must not block `applied`. Instead of losing it in a warning, record
  // durable recovery work (drained by manual sync / retrySemanticRecovery).
  try {
    await deps.postApplyRefresh(VAULT_PATH, outcome.affected ?? []);
  } catch (error) {
    console.warn(`resolveProposal: post-apply semantic refresh failed for ${id}:`, error);
    await enqueueSemanticRecovery(outcome.affected ?? []);
  }

  const applied = resolveProposalRecord(proposal, "applied", note, nowIso());
  await saveProposal(apothecaryHome(), applied);
  return { resolved: true, proposalId: id, type: proposal.type, status: "applied" };
}

/** Read-only listing for the tool layer. */
export function listProposalRecords(
  filter: Parameters<typeof listProposals>[1] = {},
): Promise<Proposal[]> {
  return listProposals(apothecaryHome(), filter);
}
