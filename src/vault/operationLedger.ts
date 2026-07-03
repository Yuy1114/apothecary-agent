import { createClient, type Client } from "@libsql/client";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";

export type OperationType =
  | "edit"
  | "move"
  | "archive"
  | "merge"
  | "structure"
  | "ingest"
  | "capture";

export type OperationRecord = {
  id: string;
  type: OperationType;
  targetFiles: string[];
  rationale: string;
  source: string;
  appliedAt: string;
  detail: string;
};

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
  try {
    await client.execute({
      sql: `INSERT INTO operation_ledger (id, type, target_files, rationale, source, applied_at, detail)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        createId("op"),
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
  }
}

export async function listOperations(query: {
  filePath?: string;
  type?: OperationType;
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
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  args.push(query.limit ?? 50);

  const result = await client.execute({
    sql: `SELECT id, type, target_files, rationale, source, applied_at, detail
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
  }));
}
