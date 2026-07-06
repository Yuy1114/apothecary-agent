/**
 * In-process guard that lets the vault watcher tell agent-applied writes apart
 * from genuine external edits. When a proposal is approved and executed, the
 * resulting file writes are already accounted for (proposal → approval →
 * operation ledger + semantic refresh), so the change-awareness queue must not
 * re-capture them as pending work. The applying code marks the paths it is about
 * to (or just did) write; the watcher skips enqueueing any marked path.
 *
 * This is deliberately in-memory: the watcher and the apply path share one
 * process in the packaged app and in the default `desktop:dev` (watcher on). A
 * short TTL absorbs `fs.watch` latency and the duplicate events it fires per
 * write, then expires so a later external edit to the same file is still caught.
 */
const DEFAULT_TTL_MS = 8_000;
const marks = new Map<string, number>();

/** Normalise to the vault-relative POSIX form the watcher and ledger use. */
function key(relativePath: string): string {
  return relativePath.split(/[\\/]/).join("/").replace(/^\.\//, "");
}

/** Register vault-relative paths the agent is writing, so the watcher ignores them. */
export function markSelfWrite(paths: Iterable<string>, ttlMs: number = DEFAULT_TTL_MS): void {
  const expiry = Date.now() + ttlMs;
  for (const relativePath of paths) {
    if (relativePath) marks.set(key(relativePath), expiry);
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
