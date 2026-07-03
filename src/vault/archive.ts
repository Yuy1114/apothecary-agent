import path from "node:path";

/**
 * Vault-relative directory that holds archived notes. Archiving is a
 * non-destructive alternative to deletion: the file still exists on disk (users
 * can browse it) but it leaves the active knowledge picture — excluded from
 * scans/semantic passes (see VAULT_IGNORE_GLOBS) and removed from the search
 * index. Distinct from `.trash/`, which implies eventual deletion.
 */
export const ARCHIVE_DIR = "archive";

/** Whether a vault-relative path already lives under the archive directory. */
export function isArchivedPath(relPath: string): boolean {
  const posix = relPath.split(path.sep).join("/");
  return posix === ARCHIVE_DIR || posix.startsWith(`${ARCHIVE_DIR}/`);
}

/**
 * The archive destination for a note, mirroring its original structure under
 * the archive root (e.g. `notes/db/redis.md` → `archive/notes/db/redis.md`).
 * Collision handling is layered on top by the caller via {@link withCollisionSuffix}.
 */
export function archiveTargetPath(from: string): string {
  const posix = from.split(path.sep).join("/");
  return `${ARCHIVE_DIR}/${posix}`;
}

/**
 * Insert a ` (n)` disambiguator before the file extension so a second archive of
 * the same original path never overwrites the first
 * (e.g. `archive/notes/a.md`, n=1 → `archive/notes/a (1).md`).
 */
export function withCollisionSuffix(relPath: string, n: number): string {
  const dir = path.posix.dirname(relPath);
  const ext = path.posix.extname(relPath);
  const base = path.posix.basename(relPath, ext);
  const renamed = `${base} (${n})${ext}`;
  return dir === "." ? renamed : `${dir}/${renamed}`;
}
