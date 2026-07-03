import { promises as fs } from "node:fs";
import path from "node:path";
import { reindexFile } from "./rag.js";
import { moveVaultFileCore } from "./move-vault-file-core.js";
import { archiveVaultFileCore } from "./archive-vault-file-core.js";
import { mergeNotesCore } from "./merge-notes-core.js";
import { recordOperation } from "../../vault/operationLedger.js";
import { loadProposal, saveProposal, listProposals } from "../../vault/proposalStore.js";
import { resolveProposalRecord, type Proposal } from "../../domain/proposal.js";
import { nowIso } from "../../utils/time.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

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
async function executeProposal(proposal: Proposal): Promise<{ ok: boolean; reason?: string }> {
  switch (proposal.type) {
    case "edit": {
      const { filePath, suggestedContent } = proposal.payload;
      const abs = path.join(VAULT_PATH, filePath);
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
      return { ok: true };
    }
    case "move": {
      const r = await moveVaultFileCore(proposal.payload.from, proposal.payload.to);
      return r.moved ? { ok: true } : { ok: false, reason: r.reason };
    }
    case "archive": {
      const r = await archiveVaultFileCore(proposal.payload.from, { reason: proposal.rationale });
      return r.archived ? { ok: true } : { ok: false, reason: r.reason };
    }
    case "merge": {
      const r = await mergeNotesCore({ ...proposal.payload, reason: proposal.rationale });
      return r.merged ? { ok: true } : { ok: false, reason: r.reason };
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

  const outcome = await executeProposal(proposal);
  if (!outcome.ok) {
    // Leave the proposal open so it can be fixed and retried, not silently lost.
    return { resolved: false, proposalId: id, type: proposal.type, reason: outcome.reason ?? "apply_failed" };
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
