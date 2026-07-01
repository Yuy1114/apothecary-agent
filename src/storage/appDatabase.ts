import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type ActivityType = "server" | "file" | "index" | "job" | "proposal" | "memory" | "error";

export type ActivityEventRecord = {
  id: number;
  type: ActivityType;
  message: string;
  path?: string;
  createdAt: string;
};

export type FileStatus = "active" | "deleted" | "error" | "stale";

export type FileRecord = {
  id: number;
  path: string;
  hash: string | null;
  observedHash: string | null;
  indexedHash: string | null;
  status: FileStatus;
  lastSeenAt: string | null;
  indexedAt: string | null;
  deletedAt: string | null;
  errorMessage: string | null;
};

export type ProposalRecord = {
  id: number;
  type: string;
  title: string;
  status: "proposed" | "approved" | "rejected" | "applied";
  reason: string | null;
  operationsJson: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationThreadRecord = {
  id: string;
  title: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
};

export type ConversationMessageRecord = {
  id: number;
  threadId: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  metadataJson: string | null;
  createdAt: string;
};

export type ConversationSummaryRecord = {
  id: number;
  threadId: string;
  summary: string;
  coveredMessageIdFrom: number | null;
  coveredMessageIdTo: number | null;
  createdAt: string;
};

export type MemoryCandidateRecord = {
  id: number;
  threadId: string | null;
  sourceMessageId: number | null;
  content: string;
  reason: string;
  target: "user_memory" | "project_memory" | "vault_note";
  status: "proposed" | "accepted" | "rejected" | "written";
  createdAt: string;
  updatedAt: string;
};

export type SyncJobType = "reindex_file" | "remove_file" | "reindex_vault";
export type SyncJobStatus = "pending" | "running" | "succeeded" | "failed";

export type SyncJobRecord = {
  id: number;
  type: SyncJobType;
  path: string | null;
  status: SyncJobStatus;
  attempts: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type SyncStatusRecord = {
  activeFiles: number;
  staleFiles: number;
  errorFiles: number;
  deletedFiles: number;
  pendingJobs: number;
  runningJobs: number;
  failedJobs: number;
};

export class AppDatabase {
  private readonly database: DatabaseSync;

  private constructor(private readonly dbPath: string) {
    this.database = new DatabaseSync(dbPath);
    this.initialize();
  }

  static async open(vaultPath: string): Promise<AppDatabase> {
    const agentDirectory = path.join(vaultPath, ".agent");
    await mkdir(agentDirectory, { recursive: true });
    return new AppDatabase(path.join(agentDirectory, "app.db"));
  }

  close(): void {
    this.database.close();
  }

  get path(): string {
    return this.dbPath;
  }

  recordActivity(input: { type: ActivityType; message: string; path?: string }): ActivityEventRecord {
    const result = this.database
      .prepare(
        `INSERT INTO activity_events (type, message, path)
         VALUES (?, ?, ?)`,
      )
      .run(input.type, input.message, input.path ?? null);

    return this.getActivityById(Number(result.lastInsertRowid));
  }

  listActivity(limit = 100): ActivityEventRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, type, message, path, created_at
         FROM activity_events
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(limit) as ActivityEventRow[];

    return rows.map(toActivityEventRecord);
  }

  observeFile(input: { path: string; hash: string }): FileRecord {
    const existing = this.getFileByPath(input.path);
    const status: FileStatus = existing?.indexedHash === input.hash ? "active" : "stale";

    this.database
      .prepare(
        `INSERT INTO files (path, hash, observed_hash, status, last_seen_at, deleted_at, error_message)
         VALUES (?, NULL, ?, ?, CURRENT_TIMESTAMP, NULL, NULL)
         ON CONFLICT(path) DO UPDATE SET
           observed_hash = excluded.observed_hash,
           status = excluded.status,
           last_seen_at = CURRENT_TIMESTAMP,
           deleted_at = NULL,
           error_message = NULL,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(input.path, input.hash, status);

    return this.mustGetFileByPath(input.path);
  }

  markFileIndexed(input: { path: string; hash: string }): FileRecord {
    this.database
      .prepare(
        `INSERT INTO files (path, hash, observed_hash, indexed_hash, status, last_seen_at, indexed_at, deleted_at, error_message)
         VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL)
         ON CONFLICT(path) DO UPDATE SET
           hash = excluded.hash,
           observed_hash = excluded.observed_hash,
           indexed_hash = excluded.indexed_hash,
           status = 'active',
           last_seen_at = CURRENT_TIMESTAMP,
           indexed_at = CURRENT_TIMESTAMP,
           deleted_at = NULL,
           error_message = NULL,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(input.path, input.hash, input.hash, input.hash);

    return this.mustGetFileByPath(input.path);
  }

  markFileError(input: { path: string; errorMessage: string }): FileRecord {
    this.database
      .prepare(
        `INSERT INTO files (path, status, error_message)
         VALUES (?, 'error', ?)
         ON CONFLICT(path) DO UPDATE SET
           status = 'error',
           error_message = excluded.error_message,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(input.path, input.errorMessage);

    return this.mustGetFileByPath(input.path);
  }

  markFileDeleted(relativePath: string): FileRecord {
    this.database
      .prepare(
        `INSERT INTO files (path, status, deleted_at)
         VALUES (?, 'deleted', CURRENT_TIMESTAMP)
         ON CONFLICT(path) DO UPDATE SET
           status = 'deleted',
           deleted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(relativePath);

    return this.mustGetFileByPath(relativePath);
  }

  getFileByPath(relativePath: string): FileRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, path, hash, observed_hash, indexed_hash, status, last_seen_at, indexed_at, deleted_at, error_message
         FROM files
         WHERE path = ?`,
      )
      .get(relativePath) as FileRow | undefined;

    return row ? toFileRecord(row) : null;
  }

  createProposal(input: {
    type: string;
    title: string;
    reason?: string;
    operations: unknown;
  }): ProposalRecord {
    const result = this.database
      .prepare(
        `INSERT INTO proposals (type, title, status, reason, operations_json)
         VALUES (?, ?, 'proposed', ?, ?)`,
      )
      .run(input.type, input.title, input.reason ?? null, JSON.stringify(input.operations));

    return this.getProposalById(Number(result.lastInsertRowid));
  }

  listProposals(limit = 100): ProposalRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, type, title, status, reason, operations_json, created_at, updated_at
         FROM proposals
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(limit) as ProposalRow[];

    return rows.map(toProposalRecord);
  }

  getProposal(id: number): ProposalRecord {
    return this.getProposalById(id);
  }

  updateProposalStatus(id: number, status: ProposalRecord["status"]): ProposalRecord {
    this.database
      .prepare(
        `UPDATE proposals
         SET status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(status, id);

    return this.getProposalById(id);
  }

  ensureConversationThread(input: { id: string; title: string }): ConversationThreadRecord {
    this.database
      .prepare(
        `INSERT INTO conversation_threads (id, title)
         VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = CASE
             WHEN conversation_threads.title = conversation_threads.id THEN excluded.title
             ELSE conversation_threads.title
           END,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(input.id, input.title);

    return this.getConversationThread(input.id);
  }

  touchConversationThread(input: { id: string; title?: string }): ConversationThreadRecord {
    this.ensureConversationThread({ id: input.id, title: input.title ?? input.id });
    this.database
      .prepare(
        `UPDATE conversation_threads
         SET title = CASE
             WHEN ? IS NOT NULL AND title = id THEN ?
             ELSE title
           END,
             last_message_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(input.title ?? null, input.title ?? null, input.id);

    return this.getConversationThread(input.id);
  }

  listConversationThreads(limit = 50): ConversationThreadRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, title, status, created_at, updated_at, last_message_at
         FROM conversation_threads
         ORDER BY COALESCE(last_message_at, updated_at) DESC
         LIMIT ?`,
      )
      .all(limit) as ConversationThreadRow[];

    return rows.map(toConversationThreadRecord);
  }

  getConversationThread(id: string): ConversationThreadRecord {
    const row = this.database
      .prepare(
        `SELECT id, title, status, created_at, updated_at, last_message_at
         FROM conversation_threads
         WHERE id = ?`,
      )
      .get(id) as ConversationThreadRow | undefined;

    if (!row) throw new Error(`conversation thread not found: ${id}`);
    return toConversationThreadRecord(row);
  }

  appendConversationMessage(input: {
    threadId: string;
    role: ConversationMessageRecord["role"];
    content: string;
    metadata?: unknown;
  }): ConversationMessageRecord {
    this.ensureConversationThread({ id: input.threadId, title: input.threadId });
    const result = this.database
      .prepare(
        `INSERT INTO conversation_messages (thread_id, role, content, metadata_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        input.threadId,
        input.role,
        input.content,
        input.metadata === undefined ? null : JSON.stringify(input.metadata),
      );
    this.touchConversationThread({
      id: input.threadId,
      title: input.role === "user" ? deriveThreadTitle(input.content) : undefined,
    });

    return this.getConversationMessage(Number(result.lastInsertRowid));
  }

  listConversationMessages(threadId: string, limit = 100): ConversationMessageRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, thread_id, role, content, metadata_json, created_at
         FROM conversation_messages
         WHERE thread_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(threadId, limit) as ConversationMessageRow[];

    return rows.reverse().map(toConversationMessageRecord);
  }

  createConversationSummary(input: {
    threadId: string;
    summary: string;
    coveredMessageIdFrom?: number;
    coveredMessageIdTo?: number;
  }): ConversationSummaryRecord {
    this.ensureConversationThread({ id: input.threadId, title: input.threadId });
    const result = this.database
      .prepare(
        `INSERT INTO conversation_summaries (thread_id, summary, covered_message_id_from, covered_message_id_to)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        input.threadId,
        input.summary,
        input.coveredMessageIdFrom ?? null,
        input.coveredMessageIdTo ?? null,
      );

    return this.getConversationSummary(Number(result.lastInsertRowid));
  }

  getLatestConversationSummary(threadId: string): ConversationSummaryRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, thread_id, summary, covered_message_id_from, covered_message_id_to, created_at
         FROM conversation_summaries
         WHERE thread_id = ?
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(threadId) as ConversationSummaryRow | undefined;

    return row ? toConversationSummaryRecord(row) : null;
  }

  upsertMemoryCandidate(input: {
    threadId?: string;
    sourceMessageId?: number;
    content: string;
    reason: string;
    target: MemoryCandidateRecord["target"];
  }): MemoryCandidateRecord {
    const existing = this.database
      .prepare(
        `SELECT id, thread_id, source_message_id, content, reason, target, status, created_at, updated_at
         FROM memory_candidates
         WHERE content = ? AND target = ? AND status = 'proposed'
         LIMIT 1`,
      )
      .get(input.content, input.target) as MemoryCandidateRow | undefined;

    if (existing) return toMemoryCandidateRecord(existing);

    const result = this.database
      .prepare(
        `INSERT INTO memory_candidates (thread_id, source_message_id, content, reason, target, status)
         VALUES (?, ?, ?, ?, ?, 'proposed')`,
      )
      .run(
        input.threadId ?? null,
        input.sourceMessageId ?? null,
        input.content,
        input.reason,
        input.target,
      );

    return this.getMemoryCandidate(Number(result.lastInsertRowid));
  }

  listMemoryCandidates(status: MemoryCandidateRecord["status"] | "all" = "proposed", limit = 100): MemoryCandidateRecord[] {
    const rows = status === "all"
      ? this.database
        .prepare(
          `SELECT id, thread_id, source_message_id, content, reason, target, status, created_at, updated_at
           FROM memory_candidates
           ORDER BY id DESC
           LIMIT ?`,
        )
        .all(limit) as MemoryCandidateRow[]
      : this.database
        .prepare(
          `SELECT id, thread_id, source_message_id, content, reason, target, status, created_at, updated_at
           FROM memory_candidates
           WHERE status = ?
           ORDER BY id DESC
           LIMIT ?`,
        )
        .all(status, limit) as MemoryCandidateRow[];

    return rows.map(toMemoryCandidateRecord);
  }

  updateMemoryCandidateStatus(id: number, status: MemoryCandidateRecord["status"]): MemoryCandidateRecord {
    this.database
      .prepare(
        `UPDATE memory_candidates
         SET status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(status, id);

    return this.getMemoryCandidate(id);
  }

  getMemoryCandidateById(id: number): MemoryCandidateRecord {
    return this.getMemoryCandidate(id);
  }

  enqueueSyncJob(input: { type: SyncJobType; path?: string }): SyncJobRecord {
    const existing = this.database
      .prepare(
        `SELECT id, type, path, status, attempts, error_message, created_at, started_at, finished_at, updated_at
         FROM sync_jobs
         WHERE type = ? AND COALESCE(path, '') = COALESCE(?, '') AND status IN ('pending', 'running')
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(input.type, input.path ?? null) as SyncJobRow | undefined;

    if (existing) return toSyncJobRecord(existing);

    const result = this.database
      .prepare(
        `INSERT INTO sync_jobs (type, path, status)
         VALUES (?, ?, 'pending')`,
      )
      .run(input.type, input.path ?? null);

    return this.getSyncJob(Number(result.lastInsertRowid));
  }

  listSyncJobs(limit = 100): SyncJobRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, type, path, status, attempts, error_message, created_at, started_at, finished_at, updated_at
         FROM sync_jobs
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(limit) as SyncJobRow[];

    return rows.map(toSyncJobRecord);
  }

  claimNextPendingSyncJob(): SyncJobRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, type, path, status, attempts, error_message, created_at, started_at, finished_at, updated_at
         FROM sync_jobs
         WHERE status = 'pending'
         ORDER BY id ASC
         LIMIT 1`,
      )
      .get() as SyncJobRow | undefined;

    if (!row) return null;
    this.database
      .prepare(
        `UPDATE sync_jobs
         SET status = 'running', attempts = attempts + 1, started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(row.id);

    return this.getSyncJob(row.id);
  }

  markSyncJobSucceeded(id: number): SyncJobRecord {
    this.database
      .prepare(
        `UPDATE sync_jobs
         SET status = 'succeeded', error_message = NULL, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(id);

    return this.getSyncJob(id);
  }

  markSyncJobFailed(id: number, errorMessage: string): SyncJobRecord {
    this.database
      .prepare(
        `UPDATE sync_jobs
         SET status = 'failed', error_message = ?, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(errorMessage, id);

    return this.getSyncJob(id);
  }

  getSyncStatus(): SyncStatusRecord {
    const fileCounts = this.database
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS activeFiles,
           SUM(CASE WHEN status = 'stale' THEN 1 ELSE 0 END) AS staleFiles,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errorFiles,
           SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) AS deletedFiles
         FROM files`,
      )
      .get() as Partial<SyncStatusRecord>;
    const jobCounts = this.database
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingJobs,
           SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS runningJobs,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedJobs
         FROM sync_jobs`,
      )
      .get() as Partial<SyncStatusRecord>;

    return {
      activeFiles: Number(fileCounts.activeFiles ?? 0),
      staleFiles: Number(fileCounts.staleFiles ?? 0),
      errorFiles: Number(fileCounts.errorFiles ?? 0),
      deletedFiles: Number(fileCounts.deletedFiles ?? 0),
      pendingJobs: Number(jobCounts.pendingJobs ?? 0),
      runningJobs: Number(jobCounts.runningJobs ?? 0),
      failedJobs: Number(jobCounts.failedJobs ?? 0),
    };
  }

  private getSyncJob(id: number): SyncJobRecord {
    const row = this.database
      .prepare(
        `SELECT id, type, path, status, attempts, error_message, created_at, started_at, finished_at, updated_at
         FROM sync_jobs
         WHERE id = ?`,
      )
      .get(id) as SyncJobRow;

    return toSyncJobRecord(row);
  }

  private initialize(): void {
    this.database.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        hash TEXT,
        observed_hash TEXT,
        indexed_hash TEXT,
        status TEXT NOT NULL DEFAULT 'stale',
        last_seen_at DATETIME,
        indexed_at DATETIME,
        deleted_at DATETIME,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS activity_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'proposed',
        reason TEXT,
        operations_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS conversation_threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_message_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(thread_id) REFERENCES conversation_threads(id)
      );

      CREATE TABLE IF NOT EXISTS conversation_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        covered_message_id_from INTEGER,
        covered_message_id_to INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(thread_id) REFERENCES conversation_threads(id)
      );

      CREATE TABLE IF NOT EXISTS memory_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT,
        source_message_id INTEGER,
        content TEXT NOT NULL,
        reason TEXT NOT NULL,
        target TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'proposed',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(thread_id) REFERENCES conversation_threads(id),
        FOREIGN KEY(source_message_id) REFERENCES conversation_messages(id)
      );

      CREATE TABLE IF NOT EXISTS sync_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        path TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        finished_at DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
      CREATE INDEX IF NOT EXISTS idx_activity_events_created_at ON activity_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
      CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread_id ON conversation_messages(thread_id, id);
      CREATE INDEX IF NOT EXISTS idx_conversation_summaries_thread_id ON conversation_summaries(thread_id, id);
      CREATE INDEX IF NOT EXISTS idx_memory_candidates_status ON memory_candidates(status);
      CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status, id);
      CREATE INDEX IF NOT EXISTS idx_sync_jobs_type_path ON sync_jobs(type, path, status);
    `);
  }

  private getActivityById(id: number): ActivityEventRecord {
    const row = this.database
      .prepare(
        `SELECT id, type, message, path, created_at
         FROM activity_events
         WHERE id = ?`,
      )
      .get(id) as ActivityEventRow;

    return toActivityEventRecord(row);
  }

  private mustGetFileByPath(relativePath: string): FileRecord {
    const file = this.getFileByPath(relativePath);
    if (!file) throw new Error(`file ledger row not found: ${relativePath}`);
    return file;
  }

  private getProposalById(id: number): ProposalRecord {
    const row = this.database
      .prepare(
        `SELECT id, type, title, status, reason, operations_json, created_at, updated_at
         FROM proposals
         WHERE id = ?`,
      )
      .get(id) as ProposalRow;

    return toProposalRecord(row);
  }

  private getConversationMessage(id: number): ConversationMessageRecord {
    const row = this.database
      .prepare(
        `SELECT id, thread_id, role, content, metadata_json, created_at
         FROM conversation_messages
         WHERE id = ?`,
      )
      .get(id) as ConversationMessageRow;

    return toConversationMessageRecord(row);
  }

  private getConversationSummary(id: number): ConversationSummaryRecord {
    const row = this.database
      .prepare(
        `SELECT id, thread_id, summary, covered_message_id_from, covered_message_id_to, created_at
         FROM conversation_summaries
         WHERE id = ?`,
      )
      .get(id) as ConversationSummaryRow;

    return toConversationSummaryRecord(row);
  }

  private getMemoryCandidate(id: number): MemoryCandidateRecord {
    const row = this.database
      .prepare(
        `SELECT id, thread_id, source_message_id, content, reason, target, status, created_at, updated_at
         FROM memory_candidates
         WHERE id = ?`,
      )
      .get(id) as MemoryCandidateRow;

    return toMemoryCandidateRecord(row);
  }
}

type ActivityEventRow = {
  id: number;
  type: ActivityType;
  message: string;
  path: string | null;
  created_at: string;
};

type FileRow = {
  id: number;
  path: string;
  hash: string | null;
  observed_hash: string | null;
  indexed_hash: string | null;
  status: FileStatus;
  last_seen_at: string | null;
  indexed_at: string | null;
  deleted_at: string | null;
  error_message: string | null;
};

type ProposalRow = {
  id: number;
  type: string;
  title: string;
  status: ProposalRecord["status"];
  reason: string | null;
  operations_json: string;
  created_at: string;
  updated_at: string;
};

type ConversationThreadRow = {
  id: string;
  title: string;
  status: ConversationThreadRecord["status"];
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
};

type ConversationMessageRow = {
  id: number;
  thread_id: string;
  role: ConversationMessageRecord["role"];
  content: string;
  metadata_json: string | null;
  created_at: string;
};

type ConversationSummaryRow = {
  id: number;
  thread_id: string;
  summary: string;
  covered_message_id_from: number | null;
  covered_message_id_to: number | null;
  created_at: string;
};

type MemoryCandidateRow = {
  id: number;
  thread_id: string | null;
  source_message_id: number | null;
  content: string;
  reason: string;
  target: MemoryCandidateRecord["target"];
  status: MemoryCandidateRecord["status"];
  created_at: string;
  updated_at: string;
};

type SyncJobRow = {
  id: number;
  type: SyncJobType;
  path: string | null;
  status: SyncJobStatus;
  attempts: number;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

function toActivityEventRecord(row: ActivityEventRow): ActivityEventRecord {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    path: row.path ?? undefined,
    createdAt: row.created_at,
  };
}

function toFileRecord(row: FileRow): FileRecord {
  return {
    id: row.id,
    path: row.path,
    hash: row.hash,
    observedHash: row.observed_hash,
    indexedHash: row.indexed_hash,
    status: row.status,
    lastSeenAt: row.last_seen_at,
    indexedAt: row.indexed_at,
    deletedAt: row.deleted_at,
    errorMessage: row.error_message,
  };
}

function toProposalRecord(row: ProposalRow): ProposalRecord {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    status: row.status,
    reason: row.reason,
    operationsJson: row.operations_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toConversationThreadRecord(row: ConversationThreadRow): ConversationThreadRecord {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
  };
}

function toConversationMessageRecord(row: ConversationMessageRow): ConversationMessageRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    content: row.content,
    metadataJson: row.metadata_json,
    createdAt: row.created_at,
  };
}

function toConversationSummaryRecord(row: ConversationSummaryRow): ConversationSummaryRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    summary: row.summary,
    coveredMessageIdFrom: row.covered_message_id_from,
    coveredMessageIdTo: row.covered_message_id_to,
    createdAt: row.created_at,
  };
}

function toMemoryCandidateRecord(row: MemoryCandidateRow): MemoryCandidateRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    sourceMessageId: row.source_message_id,
    content: row.content,
    reason: row.reason,
    target: row.target,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSyncJobRecord(row: SyncJobRow): SyncJobRecord {
  return {
    id: row.id,
    type: row.type,
    path: row.path,
    status: row.status,
    attempts: row.attempts,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

function deriveThreadTitle(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  return oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine || "Untitled chat";
}
