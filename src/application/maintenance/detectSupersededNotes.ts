import { promises as fs } from "node:fs";
import path from "node:path";
import { scanVault } from "../../vault/scanner.js";
import { VAULT_IGNORE_GLOBS } from "../../domain/vaultPolicy.js";
import { getFrontmatterKey } from "../../vault/frontmatter.js";
import type { SupersededNote } from "../../domain/maintenanceFindings.js";

/**
 * Find active markdown notes that carry a `superseded_by` frontmatter link — a
 * canonical_note proposal stamped them, but they are still sitting in the active
 * vault and are candidates for archiving. The archive subtree is excluded by
 * VAULT_IGNORE_GLOBS, so already-archived notes never appear here.
 */
export async function detectSupersededNotes(vaultPath: string): Promise<SupersededNote[]> {
  const scan = await scanVault({ vaultPath, includeHash: false, ignore: VAULT_IGNORE_GLOBS });
  const markdown = scan.files.filter((file) => file.mediaType === "markdown");

  const results: SupersededNote[] = [];
  for (const file of markdown) {
    try {
      const content = await fs.readFile(path.join(vaultPath, file.path), "utf8");
      const supersededBy = getFrontmatterKey(content, "superseded_by");
      if (typeof supersededBy === "string" && supersededBy.trim()) {
        results.push({ path: file.path, supersededBy });
      }
    } catch {
      // Unreadable note → skip.
    }
  }

  return results.sort((a, b) => a.path.localeCompare(b.path));
}
