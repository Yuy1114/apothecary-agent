import { createClient, type Client } from "@libsql/client";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";

export type ChangeType = "created" | "modified" | "deleted";
export type ChangeSource = "watcher" | "manual" | "proposal";
export type ChangeStatus = "pending" | "processed" | "dismissed";

export type PendingChange = {
  id: string;
  path: string;
  changeType: ChangeType;
  source: ChangeSource;
  detectedAt: string;
};

/** A change row regardless of triage state, for history views. */
export type ChangeRecord = PendingChange & {
  status: ChangeStatus;
  /** Vault git commit that captured this external edit, when versioning is on. */
  commitSha?: string;
};

// ── Client singleton (set at startup, see index.ts) ──

let client: Client | null = null;

/**
 * Initialize the change ledger against its own libsql database and ensure the
 * table exists. Safe to call once at startup. Until called, all ledger
 * operations are no-ops so tests and DB-less runs never throw.
 */
export async function initChangeLog(dbUrl: string): Promise<void> {
  const db = createClient({ url: dbUrl });
  await db.execute(`
    CREATE TABLE IF NOT EXISTS vault_change_log (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      change_type TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      detected_at TEXT NOT NULL,
      processed_at TEXT
    )
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_change_log_status ON vault_change_log(status)`,
  );
  try {
    await db.execute(`ALTER TABLE vault_change_log ADD COLUMN commit_sha TEXT`);
  } catch {
    // Column already exists.
  }
  client = db;
}

/** Test/teardown hook to inject a client directly. */
export function setChangeLogClient(db: Client | null): void {
  client = db;
}

/**
 * Record a vault change as pending agent-work. Deduplicates: if a pending row
 * already exists for the path, its type and timestamp are refreshed instead of
 * inserting a duplicate.
 */
export async function enqueueChange(change: {
  path: string;
  changeType: ChangeType;
  source: ChangeSource;
}): Promise<void> {
  if (!client) return;

  const existing = await client.execute({
    sql: `SELECT id FROM vault_change_log WHERE path = ? AND status = 'pending' LIMIT 1`,
    args: [change.path],
  });

  const detectedAt = nowIso();
  if (existing.rows.length > 0) {
    await client.execute({
      sql: `UPDATE vault_change_log SET change_type = ?, detected_at = ? WHERE id = ?`,
      args: [change.changeType, detectedAt, existing.rows[0].id as string],
    });
    return;
  }

  await client.execute({
    sql: `INSERT INTO vault_change_log (id, path, change_type, source, status, detected_at)
          VALUES (?, ?, ?, ?, 'pending', ?)`,
    args: [createId("change"), change.path, change.changeType, change.source, detectedAt],
  });
}

export async function listPendingChanges(): Promise<PendingChange[]> {
  if (!client) return [];
  const result = await client.execute(
    `SELECT id, path, change_type, source, detected_at
     FROM vault_change_log WHERE status = 'pending' ORDER BY detected_at DESC`,
  );
  return result.rows.map((row) => ({
    id: row.id as string,
    path: row.path as string,
    changeType: row.change_type as ChangeType,
    source: row.source as ChangeSource,
    detectedAt: row.detected_at as string,
  }));
}

/**
 * List changes detected since a cutoff, regardless of triage status — the
 * "what happened to my vault recently" view, as opposed to the pending queue.
 */
export async function listRecentChanges(options: {
  since: string;
  limit?: number;
}): Promise<ChangeRecord[]> {
  if (!client) return [];
  const result = await client.execute({
    sql: `SELECT id, path, change_type, source, status, detected_at, commit_sha
          FROM vault_change_log WHERE detected_at >= ?
          ORDER BY detected_at DESC LIMIT ?`,
    args: [options.since, options.limit ?? 200],
  });
  return result.rows.map((row) => ({
    id: row.id as string,
    path: row.path as string,
    changeType: row.change_type as ChangeType,
    source: row.source as ChangeSource,
    status: row.status as ChangeStatus,
    detectedAt: row.detected_at as string,
    commitSha: (row.commit_sha as string | null) ?? undefined,
  }));
}

/**
 * Stamp the vault-git commit that captured a settled batch of external edits
 * onto the change rows it covered. The `since` guard keeps the stamp off older
 * unsnapshotted rows for the same paths (e.g. pre-versioning history).
 */
export async function markChangesSnapshotted(
  paths: string[],
  commitSha: string,
  since: string,
): Promise<number> {
  if (!client || paths.length === 0) return 0;
  const placeholders = paths.map(() => "?").join(", ");
  const result = await client.execute({
    sql: `UPDATE vault_change_log SET commit_sha = ?
          WHERE path IN (${placeholders}) AND commit_sha IS NULL AND detected_at >= ?`,
    args: [commitSha, ...paths, since],
  });
  return result.rowsAffected;
}

export async function resolveChanges(
  ids: string[],
  outcome: "processed" | "dismissed",
): Promise<number> {
  if (!client || ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  const result = await client.execute({
    sql: `UPDATE vault_change_log SET status = ?, processed_at = ?
          WHERE id IN (${placeholders}) AND status = 'pending'`,
    args: [outcome, nowIso(), ...ids],
  });
  return result.rowsAffected;
}

/**
 * Mark any pending changes for the given paths as processed. Called when the
 * agent itself acts on a path (move / archive / intake), so a change queued
 * earlier — e.g. an inbox file first detected by manual sync — doesn't linger as
 * a stale pending item after the agent has already handled it. Returns the count
 * cleared. No-op when the ledger is uninitialised (tests / DB-less runs).
 */
export async function resolvePendingByPaths(
  paths: Iterable<string>,
  outcome: "processed" | "dismissed" = "processed",
): Promise<number> {
  if (!client) return 0;
  const unique = [...new Set(paths)].filter(Boolean);
  if (unique.length === 0) return 0;
  const placeholders = unique.map(() => "?").join(", ");
  const result = await client.execute({
    sql: `UPDATE vault_change_log SET status = ?, processed_at = ?
          WHERE path IN (${placeholders}) AND status = 'pending'`,
    args: [outcome, nowIso(), ...unique],
  });
  return result.rowsAffected;
}
