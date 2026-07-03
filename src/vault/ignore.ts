import { ARCHIVE_DIR } from "./archive.js";

/**
 * Vault subtrees that are never part of the active knowledge picture and should
 * be excluded from content scans, the semantic layer, and duplicate detection.
 * Single source of truth — passed as `scanVault({ ignore })` by every full-vault
 * pass so a new exclusion (like `archive/`) takes effect everywhere at once.
 *
 * OS/VCS/tooling junk (.DS_Store, node_modules, .git, ._*) is handled separately
 * by the scanner's own ALWAYS_IGNORE and does not need to be listed here.
 */
export const VAULT_IGNORE_GLOBS = [
  ".agent/**",
  ".apothecary/**",
  ".obsidian/**",
  ".trash/**",
  `${ARCHIVE_DIR}/**`,
];
