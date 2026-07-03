import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getAgentArtifacts } from "../artifacts/agentArtifacts.js";

/**
 * A content snapshot of the vault's markdown files, taken by manual sync so a
 * later sync can diff against it and recover changes the watcher missed. Keyed
 * by relative path → content hash.
 */
export const SyncSnapshotEntrySchema = z.object({ hash: z.string() });
export type SyncSnapshotEntry = z.infer<typeof SyncSnapshotEntrySchema>;

export const SyncSnapshotSchema = z.object({
  generatedAt: z.string(),
  files: z.record(z.string(), SyncSnapshotEntrySchema),
});
export type SyncSnapshot = z.infer<typeof SyncSnapshotSchema>;

export type SnapshotFiles = Record<string, SyncSnapshotEntry>;

export type SnapshotDiff = {
  created: string[];
  modified: string[];
  deleted: string[];
  unchanged: string[];
};

function snapshotPath(vaultPath: string): string {
  return path.join(getAgentArtifacts(vaultPath).rootPath, "sync", "snapshot.json");
}

const EMPTY_SNAPSHOT: SyncSnapshot = { generatedAt: "", files: {} };

export async function loadSnapshot(vaultPath: string): Promise<SyncSnapshot> {
  try {
    return SyncSnapshotSchema.parse(JSON.parse(await fs.readFile(snapshotPath(vaultPath), "utf8")));
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

export async function saveSnapshot(vaultPath: string, snapshot: SyncSnapshot): Promise<void> {
  const filePath = snapshotPath(vaultPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
}

/**
 * Compare a stored snapshot against the current file set (both path→hash) and
 * classify every path. Pure and deterministic — the heart of manual sync.
 *
 * - `created` — in current, absent from the snapshot.
 * - `modified` — in both, hash differs.
 * - `deleted` — in the snapshot, absent from current.
 * - `unchanged` — in both, same hash.
 */
export function diffSnapshot(previous: SnapshotFiles, current: SnapshotFiles): SnapshotDiff {
  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const unchanged: string[] = [];

  for (const [p, entry] of Object.entries(current)) {
    const prior = previous[p];
    if (!prior) created.push(p);
    else if (prior.hash !== entry.hash) modified.push(p);
    else unchanged.push(p);
  }
  for (const p of Object.keys(previous)) {
    if (!current[p]) deleted.push(p);
  }

  return {
    created: created.sort(),
    modified: modified.sort(),
    deleted: deleted.sort(),
    unchanged: unchanged.sort(),
  };
}
