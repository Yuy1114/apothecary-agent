import { promises as fs } from "node:fs";
import path from "node:path";
import { searchIndex } from "../../application/ports/searchIndex.js";
import { recordOperation } from "../../vault/operationLedger.js";
import { isArchivedPath } from "../../vault/archive.js";
import { moveToArchive } from "./archive-vault-file-core.js";
import { safeVaultPath } from "../../safety/pathSafety.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export type MergeNotesResult = {
  merged: boolean;
  sourcePath: string;
  canonicalPath: string;
  archivedTo?: string;
  reason?:
    | "same_file"
    | "empty_content"
    | "canonical_archived"
    | "source_archived"
    | "missing_source"
    | "unsafe_path";
};

/**
 * Atomically merge one note into another: write the combined content into the
 * canonical note, then archive the absorbed source — a single approval and a
 * single linked `merge` audit record, instead of a separate edit + archive.
 *
 * The canonical note may be an existing note (updated in place) or a new one
 * (created). The source is retired non-destructively into `archive/`; it is
 * never deleted. The caller supplies the final canonical content (having read
 * both notes and composed the merge), mirroring the proposeEdit model.
 */
export async function mergeNotesCore(input: {
  sourcePath: string;
  canonicalPath: string;
  canonicalContent: string;
  reason?: string;
}): Promise<MergeNotesResult> {
  const { sourcePath, canonicalPath, canonicalContent } = input;
  const fail = (reason: NonNullable<MergeNotesResult["reason"]>): MergeNotesResult => ({
    merged: false,
    sourcePath,
    canonicalPath,
    reason,
  });

  // Guard before touching anything — a merge must not silently no-op or destroy.
  if (sourcePath === canonicalPath) return fail("same_file");
  if (!canonicalContent.trim()) return fail("empty_content");
  if (isArchivedPath(canonicalPath)) return fail("canonical_archived");
  if (isArchivedPath(sourcePath)) return fail("source_archived");

  const sourceAbs = safeVaultPath(VAULT_PATH, sourcePath);
  const canonicalAbs = safeVaultPath(VAULT_PATH, canonicalPath);
  if (!sourceAbs || !canonicalAbs) return fail("unsafe_path");
  try {
    await fs.access(sourceAbs);
  } catch {
    return fail("missing_source");
  }

  // 1. Write the merged content into the canonical note (create or overwrite).
  //    The source's original content survives via the archive step below, so no
  //    information is lost even when the canonical is one of the merged pair.
  await fs.mkdir(path.dirname(canonicalAbs), { recursive: true });
  await fs.writeFile(canonicalAbs, canonicalContent, "utf8");

  // 2. Retire the absorbed source into archive/ (no separate archive op — this
  //    merge is recorded as one linked record in step 4).
  const moved = await moveToArchive(sourcePath);
  if (!moved.ok) {
    // Source vanished between the check and the move; canonical is already
    // written, so report the merge as incomplete rather than claiming success.
    return fail(moved.reason === "already_archived" ? "source_archived" : "missing_source");
  }

  // 3. Keep the index consistent: canonical content changed, source is gone.
  if (canonicalPath.endsWith(".md")) await searchIndex().reindexFile(canonicalPath);
  if (sourcePath.endsWith(".md")) await searchIndex().removeFromIndex(sourcePath);

  // 4. One audit record linking source, canonical and the archived copy.
  await recordOperation({
    type: "merge",
    targetFiles: [sourcePath, canonicalPath, moved.to],
    rationale: input.reason ?? "",
    source: "mergeNotes",
    detail: `merged ${sourcePath} into ${canonicalPath}; archived copy → ${moved.to}`,
  });

  return { merged: true, sourcePath, canonicalPath, archivedTo: moved.to };
}
