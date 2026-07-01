import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { indexVault, reindexFile, removeFromIndex } from "../rag/chromaStore.js";
import { AppDatabase, type SyncJobRecord } from "../storage/appDatabase.js";

export type SyncCoordinatorEvent = {
  type: "queued" | "started" | "succeeded" | "failed";
  job: SyncJobRecord;
  message: string;
  path?: string;
};

export class SyncCoordinator {
  private running = false;

  constructor(
    private readonly options: {
      vaultPath: string;
      appDb: AppDatabase;
      onEvent?: (event: SyncCoordinatorEvent) => void;
    },
  ) {}

  async enqueueFileChanged(relativePath: string): Promise<SyncJobRecord> {
    const normalizedPath = toPortablePath(relativePath);
    const absolutePath = path.join(this.options.vaultPath, normalizedPath);
    const content = await fs.readFile(absolutePath, "utf8");
    const fileHash = hashText(content);
    this.options.appDb.observeFile({ path: normalizedPath, hash: fileHash });
    const job = this.options.appDb.enqueueSyncJob({ type: "reindex_file", path: normalizedPath });
    this.emit("queued", job, `Queued reindex for ${normalizedPath}`, normalizedPath);
    void this.runPendingJobs();
    return job;
  }

  enqueueFileDeleted(relativePath: string): SyncJobRecord {
    const normalizedPath = toPortablePath(relativePath);
    this.options.appDb.markFileDeleted(normalizedPath);
    const job = this.options.appDb.enqueueSyncJob({ type: "remove_file", path: normalizedPath });
    this.emit("queued", job, `Queued index removal for ${normalizedPath}`, normalizedPath);
    void this.runPendingJobs();
    return job;
  }

  enqueueVaultReindex(): SyncJobRecord {
    const job = this.options.appDb.enqueueSyncJob({ type: "reindex_vault" });
    this.emit("queued", job, "Queued full vault reindex");
    void this.runPendingJobs();
    return job;
  }

  async runPendingJobs(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (true) {
        const job = this.options.appDb.claimNextPendingSyncJob();
        if (!job) return;
        this.emit("started", job, `Started sync job ${job.id}: ${job.type}`, job.path ?? undefined);
        try {
          await this.runJob(job);
          const succeeded = this.options.appDb.markSyncJobSucceeded(job.id);
          this.emit("succeeded", succeeded, `Finished sync job ${job.id}: ${job.type}`, job.path ?? undefined);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (job.path) this.options.appDb.markFileError({ path: job.path, errorMessage: message });
          const failed = this.options.appDb.markSyncJobFailed(job.id, message);
          this.emit("failed", failed, `Failed sync job ${job.id}: ${message}`, job.path ?? undefined);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async runJob(job: SyncJobRecord): Promise<void> {
    if (job.type === "reindex_vault") {
      await indexVault();
      return;
    }

    if (!job.path) throw new Error(`${job.type} requires path`);

    if (job.type === "reindex_file") {
      const absolutePath = path.join(this.options.vaultPath, job.path);
      const content = await fs.readFile(absolutePath, "utf8");
      const result = await reindexFile(job.path);
      this.options.appDb.markFileIndexed({ path: job.path, hash: hashText(content) });
      if (result.added === 0) this.options.appDb.markFileIndexed({ path: job.path, hash: hashText(content) });
      return;
    }

    if (job.type === "remove_file") {
      await removeFromIndex(job.path);
      return;
    }
  }

  private emit(type: SyncCoordinatorEvent["type"], job: SyncJobRecord, message: string, eventPath?: string): void {
    this.options.onEvent?.({ type, job, message, path: eventPath });
  }
}

function hashText(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

function toPortablePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
