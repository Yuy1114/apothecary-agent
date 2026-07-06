/**
 * In-process registry of paths a system operation is currently writing, so the
 * vault watcher can tell agent-applied writes apart from genuine external edits.
 * A system write registers its target paths BEFORE touching the filesystem
 * (`markSelfWrite`) and clears them once it has committed their hashes into the
 * sync baseline (`clearSelfWrite`, called from `commitSelfWrite`). While a path
 * is registered the watcher skips it entirely — the operation itself keeps the
 * index/ledger/baseline in step. Detection of everything else is hash-based:
 * the watcher and manual sync both diff the file against the baseline, so an
 * unregistered path is external iff its content no longer matches the baseline.
 *
 * This is deliberately in-memory: the watcher and the apply path share one
 * process in the packaged app and in the default `desktop:dev` (watcher on).
 * The mark normally lives exactly from pre-write to post-commit; a generous
 * backstop TTL only guards against an operation that throws before committing,
 * so a crashed op never blinds the watcher to a path forever.
 */
const DEFAULT_TTL_MS = 60_000;
const marks = new Map<string, number>();

/** Normalise to the vault-relative POSIX form the watcher and ledger use. */
function key(relativePath: string): string {
  return relativePath.split(/[\\/]/).join("/").replace(/^\.\//, "");
}

/** Register vault-relative paths the agent is about to write, so the watcher
 *  ignores them until the write is committed to the baseline (or the backstop
 *  TTL expires). */
export function markSelfWrite(paths: Iterable<string>, ttlMs: number = DEFAULT_TTL_MS): void {
  const expiry = Date.now() + ttlMs;
  for (const relativePath of paths) {
    if (relativePath) marks.set(key(relativePath), expiry);
  }
}

/** Clear the marks for paths a system write has finished committing, so a later
 *  external edit to the same file is detected immediately (no TTL wait). */
export function clearSelfWrite(paths: Iterable<string>): void {
  for (const relativePath of paths) {
    if (relativePath) marks.delete(key(relativePath));
  }
}

/** True when the path was recently written by the agent. Non-consuming: the mark
 *  survives (until its TTL) so the multiple fs events a single write emits are
 *  all recognised. Expired marks are pruned lazily. */
export function isSelfWrite(relativePath: string): boolean {
  const k = key(relativePath);
  const expiry = marks.get(k);
  if (expiry === undefined) return false;
  if (expiry < Date.now()) {
    marks.delete(k);
    return false;
  }
  return true;
}

/** Drop all marks. Test helper. */
export function clearSelfWriteMarks(): void {
  marks.clear();
}
