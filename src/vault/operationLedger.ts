import { createClient, type Client } from "@libsql/client";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";

export type OperationType =
  | "edit"
  | "move"
  | "archive"
  | "merge"
  | "promote"
  | "canonical"
  | "structure"
  | "ingest"
  | "capture"
  | "restore";

export type OperationRecord = {
  id: string;
  type: OperationType;
  targetFiles: string[];
  rationale: string;
  source: string;
  appliedAt: string;
  detail: string;
  /** Vault git commit that captured this operation's file changes, when versioning is on. */
  commitSha?: string;
};

/** Input recordOperation feeds to the snapshot hook after inserting the row. */
export type OperationSnapshotInput = {
  type: OperationType;
  targetFiles: string[];
  rationale: string;
  source: string;
  detail: string;
};

// Injected at the composition root (desktop runtime / mastra index) when vault
// versioning is enabled: snapshots the operation's paths into a git commit and
// returns the sha (null = nothing to commit / snapshot failed).
let snapshotHook: ((op: OperationSnapshotInput) => Promise<string | null>) | null = null;

export function setOperationSnapshotHook(
  hook: ((op: OperationSnapshotInput) => Promise<string | null>) | null,
): void {
  snapshotHook = hook;
}

// ── Client singleton (set at startup, see index.ts) ──

let client: Client | null = null;

/**
 * Initialize the operation ledger against its own libsql database and ensure
 * the table exists. Until called, all ledger operations are no-ops so tests and
 * DB-less runs never throw.
 */
export async function initOperationLedger(dbUrl: string): Promise<void> {
  const db = createClient({ url: dbUrl });
  await db.execute(`
    CREATE TABLE IF NOT EXISTS operation_ledger (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      target_files TEXT NOT NULL,
      rationale TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_operation_ledger_applied_at ON operation_ledger(applied_at)`,
  );
  try {
    await db.execute(`ALTER TABLE operation_ledger ADD COLUMN commit_sha TEXT`);
  } catch {
    // Column already exists.
  }
  client = db;
}

/** Test/teardown hook to inject a client directly. */
export function setOperationLedgerClient(db: Client | null): void {
  client = db;
}

/**
 * Append an applied-operation record to the audit ledger. Best-effort: a no-op
 * before init, and never throws — auditing must not break the apply path.
 */
export async function recordOperation(op: {
  type: OperationType;
  targetFiles: string[];
  rationale?: string;
  source: string;
  detail?: string;
}): Promise<void> {
  if (!client) return;
  const id = createId("op");
  try {
    await client.execute({
      sql: `INSERT INTO operation_ledger (id, type, target_files, rationale, source, applied_at, detail)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        op.type,
        JSON.stringify(op.targetFiles),
        op.rationale ?? "",
        op.source,
        nowIso(),
        op.detail ?? "",
      ],
    });
  } catch (error) {
    console.warn("Operation ledger: failed to record operation:", error);
    return;
  }
  // Version the applied change: one commit per operation, sha back onto the
  // row. Same never-throw stance — a failed snapshot only costs the sha link.
  if (!snapshotHook) return;
  try {
    const sha = await snapshotHook({
      type: op.type,
      targetFiles: op.targetFiles,
      rationale: op.rationale ?? "",
      source: op.source,
      detail: op.detail ?? "",
    });
    if (sha) {
      await client.execute({
        sql: `UPDATE operation_ledger SET commit_sha = ? WHERE id = ?`,
        args: [sha, id],
      });
    }
  } catch (error) {
    console.warn("Operation ledger: snapshot hook failed:", error);
  }
}

export async function listOperations(query: {
  filePath?: string;
  type?: OperationType;
  since?: string;
  limit?: number;
} = {}): Promise<OperationRecord[]> {
  if (!client) return [];

  const clauses: string[] = [];
  const args: Array<string | number> = [];
  if (query.type) {
    clauses.push("type = ?");
    args.push(query.type);
  }
  if (query.filePath) {
    clauses.push("target_files LIKE ?");
    args.push(`%${query.filePath}%`);
  }
  if (query.since) {
    clauses.push("applied_at >= ?");
    args.push(query.since);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  args.push(query.limit ?? 50);

  const result = await client.execute({
    sql: `SELECT id, type, target_files, rationale, source, applied_at, detail, commit_sha
          FROM operation_ledger ${where} ORDER BY applied_at DESC LIMIT ?`,
    args,
  });

  return result.rows.map((row) => ({
    id: row.id as string,
    type: row.type as OperationType,
    targetFiles: JSON.parse((row.target_files as string) || "[]"),
    rationale: (row.rationale as string) ?? "",
    source: row.source as string,
    appliedAt: row.applied_at as string,
    detail: (row.detail as string) ?? "",
    commitSha: (row.commit_sha as string | null) ?? undefined,
  }));
}
