import { createClient, type Client } from "@libsql/client";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";
import type { CaptureKind } from "../domain/englishCapture.js";

/**
 * Durable queue for reading-mode captures. A capture is recorded the moment it
 * is copied and settled later, because Anki is usually closed while reading and
 * AnkiConnect is the only safe way to write to a live collection.
 *
 * Shape mirrors `changeLog.ts` deliberately: init-once, no-op until initialized
 * (so tests and DB-less runs never throw), and a client setter for teardown.
 *
 * The captured text is stored — it is the card's context, and there is nowhere
 * else to keep it. It must never be logged; see the capture watcher.
 */

export type CaptureStatus = "captured" | "pushed" | "skipped" | "failed";

export type CaptureRecord = {
  id: string;
  kind: CaptureKind;
  text: string;
  lookup: string;
  sourceLabel?: string;
  status: CaptureStatus;
  outcome?: string;
  capturedAt: string;
};

let client: Client | null = null;

export async function initEnglishCaptureLog(dbUrl: string): Promise<void> {
  const db = createClient({ url: dbUrl });
  await db.execute(`
    CREATE TABLE IF NOT EXISTS english_capture_log (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      lookup TEXT NOT NULL,
      source_label TEXT,
      status TEXT NOT NULL DEFAULT 'captured',
      outcome TEXT,
      captured_at TEXT NOT NULL,
      processed_at TEXT
    )
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_english_capture_status ON english_capture_log(status)`,
  );
  client = db;
}

/** Test/teardown hook to inject a client directly. */
export function setEnglishCaptureLogClient(db: Client | null): void {
  client = db;
}

function toRecord(row: Record<string, unknown>): CaptureRecord {
  return {
    id: String(row.id),
    kind: String(row.kind) as CaptureKind,
    text: String(row.text),
    lookup: String(row.lookup),
    sourceLabel: row.source_label ? String(row.source_label) : undefined,
    status: String(row.status) as CaptureStatus,
    outcome: row.outcome ? String(row.outcome) : undefined,
    capturedAt: String(row.captured_at),
  };
}

/**
 * Record a capture. A word already waiting in the queue is not queued twice —
 * re-copying it while reading the same page is normal and should not produce two
 * cards. Returns the new row, or null when it was a duplicate or the ledger is
 * not initialized.
 */
export async function recordCapture(input: {
  kind: CaptureKind;
  text: string;
  lookup: string;
  sourceLabel?: string;
}): Promise<CaptureRecord | null> {
  if (!client) return null;

  if (input.lookup) {
    const existing = await client.execute({
      sql: `SELECT id FROM english_capture_log WHERE lookup = ? AND status = 'captured' LIMIT 1`,
      args: [input.lookup],
    });
    if (existing.rows.length > 0) return null;
  }

  const record: CaptureRecord = {
    id: createId("cap"),
    kind: input.kind,
    text: input.text,
    lookup: input.lookup,
    sourceLabel: input.sourceLabel,
    status: "captured",
    capturedAt: nowIso(),
  };
  await client.execute({
    sql: `INSERT INTO english_capture_log (id, kind, text, lookup, source_label, status, captured_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      record.id,
      record.kind,
      record.text,
      record.lookup,
      record.sourceLabel ?? null,
      record.status,
      record.capturedAt,
    ],
  });
  return record;
}

/**
 * Captures still waiting to be settled, oldest first.
 *
 * `kinds` matters: sentences are captured for the syntax breakdown, which does
 * not exist yet, so they legitimately stay pending forever. The Anki drain must
 * filter them out here rather than fetching and re-skipping them on every pass,
 * or they would fill `limit` and starve the words behind them.
 */
export async function listPendingCaptures(
  options: { limit?: number; kinds?: CaptureKind[] } = {},
): Promise<CaptureRecord[]> {
  if (!client) return [];
  const limit = options.limit ?? 50;
  const kinds = options.kinds;
  const kindFilter = kinds?.length ? ` AND kind IN (${kinds.map(() => "?").join(", ")})` : "";
  const result = await client.execute({
    sql: `SELECT * FROM english_capture_log WHERE status = 'captured'${kindFilter}
          ORDER BY captured_at ASC LIMIT ?`,
    args: [...(kinds ?? []), limit],
  });
  return result.rows.map((row) => toRecord(row as unknown as Record<string, unknown>));
}

/** Settle a capture with what happened to it. */
export async function resolveCapture(
  id: string,
  status: Exclude<CaptureStatus, "captured">,
  outcome?: string,
): Promise<void> {
  if (!client) return;
  await client.execute({
    sql: `UPDATE english_capture_log SET status = ?, outcome = ?, processed_at = ?
          WHERE id = ? AND status = 'captured'`,
    args: [status, outcome ?? null, nowIso(), id],
  });
}

/** Counts for the tray and the weekly review, per status, since a timestamp. */
export async function countCapturesSince(sinceIso: string): Promise<Record<CaptureStatus, number>> {
  const empty: Record<CaptureStatus, number> = { captured: 0, pushed: 0, skipped: 0, failed: 0 };
  if (!client) return empty;
  const result = await client.execute({
    sql: `SELECT status, COUNT(*) AS n FROM english_capture_log
          WHERE captured_at >= ? GROUP BY status`,
    args: [sinceIso],
  });
  for (const row of result.rows) {
    const status = String((row as unknown as Record<string, unknown>).status) as CaptureStatus;
    if (status in empty) empty[status] = Number((row as unknown as Record<string, unknown>).n);
  }
  return empty;
}
