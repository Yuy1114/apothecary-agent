import type { ChangeRecord } from "../../vault/changeLog.js";
import type { OperationRecord, OperationType } from "../../vault/operationLedger.js";

/**
 * One entry in the merged "what happened to my vault recently" timeline:
 * external/manual edits (change ledger) and the agent's own applied operations
 * (operation ledger) folded into a single feed. The two ledgers are disjoint by
 * design — the sync baseline keeps agent self-writes out of the change ledger —
 * so merging never double-reports an event.
 */
export type RecentActivityItem = {
  id: string;
  kind: "created" | "modified" | "deleted" | OperationType;
  actor: "user" | "agent";
  /** Primary path: where the file ended up (move/archive/merge use the result). */
  path: string;
  /** Source path for relocating operations (move/archive/merge). */
  fromPath?: string;
  at: string;
  detail?: string;
};

// Operations whose ledger entry stores [from, ..., to]: the file's current home
// is the last target, the original the first.
const RELOCATING_OPS = new Set<OperationType>(["move", "archive", "merge"]);

function operationToItem(op: OperationRecord): RecentActivityItem {
  const relocated = RELOCATING_OPS.has(op.type) && op.targetFiles.length >= 2;
  return {
    id: op.id,
    kind: op.type,
    actor: "agent",
    path: (relocated ? op.targetFiles.at(-1) : op.targetFiles[0]) ?? "",
    fromPath: relocated ? op.targetFiles[0] : undefined,
    at: op.appliedAt,
    detail: op.rationale || undefined,
  };
}

/** Merge both ledgers into one newest-first timeline, capped at `limit`. */
export function buildRecentActivity(
  changes: ChangeRecord[],
  operations: OperationRecord[],
  limit = 200,
): RecentActivityItem[] {
  const items: RecentActivityItem[] = [
    ...changes.map((change): RecentActivityItem => ({
      id: change.id,
      kind: change.changeType,
      actor: "user",
      path: change.path,
      at: change.detectedAt,
    })),
    ...operations.map(operationToItem),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
