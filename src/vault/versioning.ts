import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Vault version control: every applied change (agent operation or settled batch
 * of external edits) becomes one git commit in the vault itself, and the commit
 * sha is written back onto the ledger row that produced it. The ledgers answer
 * "what happened"; git answers "what exactly changed, and take me back".
 *
 * Plain spawned git, serialized per process. Best-effort by design: callers
 * treat a failed snapshot as a missing sha, never as a failed apply.
 */

// Commits are authored by the app so history works even when no global git
// identity is configured (a packaged .app inherits none).
const GIT_IDENTITY = ["-c", "user.name=Apothecary", "-c", "user.email=apothecary@local"];

// .obsidian/ churns on every focus change and is workspace state, not content.
const IGNORE_LINES = [".DS_Store", "**/.DS_Store", ".obsidian/"];

/** Escape hatch: APOTHECARY_VAULT_GIT=0 disables all vault git activity. */
export function vaultVersioningEnabled(): boolean {
  return process.env.APOTHECARY_VAULT_GIT !== "0";
}

// One in-process queue for all git invocations — concurrent commits would trip
// over git's index lock. (A concurrent Studio + desktop pair can still collide
// across processes; both sides treat that as a skipped snapshot.)
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function git(vaultPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...GIT_IDENTITY, ...args], {
    cwd: vaultPath,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

async function hasHead(vaultPath: string): Promise<boolean> {
  try {
    await git(vaultPath, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

async function hasStagedChanges(vaultPath: string): Promise<boolean> {
  // First status column = staged state; works identically on an unborn HEAD.
  const out = await git(vaultPath, ["status", "--porcelain"]);
  return out.split("\n").some((line) => line && line[0] !== " " && line[0] !== "?");
}

/**
 * Make sure the vault is a git repository with our ignore rules, and fold any
 * accumulated drift into a catch-up commit so later per-event commits stay
 * scoped to their event. Safe to call on every startup.
 */
export async function ensureVaultRepo(vaultPath: string): Promise<void> {
  return serialized(async () => {
    let fresh = false;
    try {
      await fs.stat(path.join(vaultPath, ".git"));
    } catch {
      await git(vaultPath, ["init"]);
      fresh = true;
    }

    // Merge (never overwrite) the ignore rules into the vault's .gitignore.
    const ignorePath = path.join(vaultPath, ".gitignore");
    let existing = "";
    try {
      existing = await fs.readFile(ignorePath, "utf8");
    } catch {
      existing = "";
    }
    const lines = new Set(existing.split("\n").map((line) => line.trim()));
    const missing = IGNORE_LINES.filter((line) => !lines.has(line));
    if (missing.length > 0) {
      const joined = `${existing.replace(/\n*$/, "")}${existing.trim() ? "\n" : ""}${missing.join("\n")}\n`;
      await fs.writeFile(ignorePath, joined, "utf8");
    }

    const message = fresh || !(await hasHead(vaultPath))
      ? "baseline: initial vault snapshot"
      : "manual: offline edits (startup catch-up)";
    await commitAll(vaultPath, message);
  });
}

// Shared by ensureVaultRepo (already inside the queue) and commitSnapshot.
async function commitAll(vaultPath: string, message: string, paths?: string[]): Promise<string | null> {
  if (paths && paths.length > 0) {
    // Scoped staging keeps unrelated concurrent edits out of this commit. A
    // pathspec can legitimately match nothing (e.g. an op on an ignored file);
    // stage per path so one dud doesn't drop the rest.
    for (const p of paths) {
      try {
        await git(vaultPath, ["add", "-A", "--", p]);
      } catch {
        // Path outside the tree / never existed — nothing to stage for it.
      }
    }
  } else {
    await git(vaultPath, ["add", "-A"]);
  }
  if (!(await hasStagedChanges(vaultPath))) return null;
  await git(vaultPath, ["commit", "-m", message]);
  return (await git(vaultPath, ["rev-parse", "HEAD"])).trim();
}

/**
 * Commit the current state of `paths` (or the whole vault) as one snapshot.
 * Returns the commit sha, or null when there was nothing to commit.
 */
export async function commitSnapshot(
  vaultPath: string,
  message: string,
  paths?: string[],
): Promise<string | null> {
  return serialized(() => commitAll(vaultPath, message, paths));
}

/**
 * File content at a commit (`ref` may be `sha` or `sha^`). Null when the path
 * does not exist at that commit — e.g. the parent side of a creation.
 */
export async function fileAtCommit(
  vaultPath: string,
  ref: string,
  filePath: string,
): Promise<string | null> {
  try {
    return await serialized(() => git(vaultPath, ["show", `${ref}:${filePath}`]));
  } catch {
    return null;
  }
}

/** Before/after content of one file across the commit `sha`. */
export async function commitFileDiff(
  vaultPath: string,
  sha: string,
  filePath: string,
): Promise<{ before: string | null; after: string | null }> {
  const [before, after] = await Promise.all([
    fileAtCommit(vaultPath, `${sha}^`, filePath),
    fileAtCommit(vaultPath, sha, filePath),
  ]);
  return { before, after };
}
