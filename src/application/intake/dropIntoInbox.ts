import { promises as fs } from "node:fs";
import path from "node:path";
import { INBOX_DIR } from "../../domain/vaultPolicy.js";
import { safeVaultPath } from "../../safety/pathSafety.js";

/**
 * The drop station's core: move files from anywhere on disk into `_inbox`.
 *
 * This is the one write in the codebase that does NOT go through the proposal
 * gate, and deliberately so. That gate exists to stop the *agent* from making
 * content decisions unattended; a person dragging a file onto the app is the
 * same act as dragging it into `_inbox` in Finder, just with less walking. What
 * happens *next* — where the file is actually filed — still becomes a proposal,
 * drafted by the intake pass the watcher schedules when these files land.
 *
 * A file already inside the vault is refused: moving one is a vault
 * reorganisation and must go through a move proposal, not a drag.
 */

export type DropStatus = "filed" | "rejected" | "failed";

export type DropOutcome = {
  /** Absolute path the file came from. */
  source: string;
  status: DropStatus;
  /** Vault-relative destination, set when filed. */
  target?: string;
  /** Set when the destination name had to be de-duplicated. */
  renamed?: boolean;
  /** Set when rejected or failed. */
  reason?: string;
};

export type DropResult = {
  outcomes: DropOutcome[];
  filed: number;
};

const MAX_NAME_ATTEMPTS = 100;

/** `notes.md` → `notes (2).md`; a directory keeps its whole name. */
export function suffixName(name: string, attempt: number): string {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  return `${stem} (${attempt})${ext}`;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** First free name in `_inbox` for this basename. */
async function freeDestination(
  inboxAbs: string,
  name: string,
): Promise<{ abs: string; name: string; renamed: boolean } | null> {
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 1 ? name : suffixName(name, attempt);
    const abs = path.join(inboxAbs, candidate);
    const exists = await fs
      .stat(abs)
      .then(() => true)
      .catch(() => false);
    if (!exists) return { abs, name: candidate, renamed: attempt > 1 };
  }
  return null;
}

/** Rename, falling back to copy+remove when the source is on another volume. */
async function moveAcrossVolumes(source: string, destination: string): Promise<void> {
  try {
    await fs.rename(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    // Downloads on an external disk, an SMB share, a DMG: rename cannot cross
    // devices, so copy then remove.
    await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false });
    await fs.rm(source, { recursive: true, force: true });
  }
}

export async function dropIntoInbox(vaultPath: string, sources: string[]): Promise<DropResult> {
  const root = path.resolve(vaultPath);
  const inboxAbs = safeVaultPath(root, INBOX_DIR);
  if (!inboxAbs) throw new Error("unsafe_inbox_path");
  await fs.mkdir(inboxAbs, { recursive: true });

  const outcomes: DropOutcome[] = [];

  for (const raw of sources) {
    const source = path.resolve(raw);
    const name = path.basename(source);

    if (!name || name === "." || name === "..") {
      outcomes.push({ source, status: "rejected", reason: "unnamed" });
      continue;
    }
    if (isInside(root, source)) {
      // Already ours. Re-filing it is a vault change and belongs in a proposal.
      outcomes.push({ source, status: "rejected", reason: "already_in_vault" });
      continue;
    }
    const exists = await fs
      .stat(source)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      outcomes.push({ source, status: "rejected", reason: "not_found" });
      continue;
    }

    const destination = await freeDestination(inboxAbs, name);
    if (!destination) {
      outcomes.push({ source, status: "failed", reason: "too_many_duplicates" });
      continue;
    }

    try {
      await moveAcrossVolumes(source, destination.abs);
      outcomes.push({
        source,
        status: "filed",
        target: `${INBOX_DIR}/${destination.name}`,
        renamed: destination.renamed,
      });
    } catch (error) {
      outcomes.push({
        source,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { outcomes, filed: outcomes.filter((o) => o.status === "filed").length };
}
