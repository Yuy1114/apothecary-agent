import { createClient } from "@libsql/client";

/**
 * Out-of-process, provably read-only view of the pending-change queue.
 *
 * `queue/change-log.db` belongs to whichever process runs the watcher (normally
 * the desktop app) and sits in rollback-journal mode, where a writer holds an
 * EXCLUSIVE lock. A second reader therefore has to do two things: prove it can
 * never write — `query_only` makes a stray INSERT fail at the connection rather
 * than corrupt the owner's queue — and wait instead of failing while the owner
 * is mid-write (`busy_timeout`).
 *
 * Anything worse than a momentary lock is reported as `degraded`, never thrown:
 * a status read must not fail just because the app happened to be busy.
 */
export type ChangeQueueSnapshot = {
  /** Pending rows, or null when the queue could not be read. */
  pending: number | null;
  degraded: boolean;
  reason?: string;
};

const MISSING_TABLE = /no such table/i;

export async function readPendingChangeCount(
  dbUrl: string,
  busyTimeoutMs = 3000,
): Promise<ChangeQueueSnapshot> {
  // `createClient` itself throws on an unopenable file, so it belongs inside
  // the guard — that failure (locked, missing parent, not a database) is the
  // whole reason this function reports rather than raises.
  let db: ReturnType<typeof createClient> | null = null;
  try {
    db = createClient({ url: dbUrl });
    await db.execute(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(busyTimeoutMs))}`);
    await db.execute("PRAGMA query_only = 1");
    const result = await db.execute(
      "SELECT count(*) AS pending FROM vault_change_log WHERE status = 'pending'",
    );
    return { pending: Number(result.rows[0]?.pending ?? 0), degraded: false };
  } catch (error) {
    // No table yet just means the queue has never been initialized — an empty
    // queue, not a fault.
    if (MISSING_TABLE.test(String(error))) return { pending: 0, degraded: false };
    return { pending: null, degraded: true, reason: String(error) };
  } finally {
    db?.close();
  }
}
