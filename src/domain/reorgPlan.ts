import type { VaultStructure } from "./vaultStructure.js";

export type ReorgMove = { from: string; to: string };

export type ReorgPlan = {
  /** Files that will be moved: their directory matched an alias prefix. */
  moves: ReorgMove[];
  /** Alias-matched files whose target already exists — skipped to avoid overwrite. */
  collisions: ReorgMove[];
  /** Number of files left untouched (no alias match). */
  unchangedCount: number;
  /** Untouched files that live under no canonical directory (informational). */
  unclassified: string[];
};

/**
 * Deterministically plan a vault reorganization from directory aliases.
 *
 * A file whose path starts with an alias source prefix is rewritten to the
 * canonical prefix, preserving the remaining sub-path. Everything else is left
 * in place. Targets that already exist (or are claimed by another move) are
 * reported as collisions and NOT moved, since a rename would overwrite them.
 */
export function planReorg(
  files: ReadonlyArray<{ path: string }>,
  structure: VaultStructure,
): ReorgPlan {
  // Longest source prefix first so nested aliases win over shallower ones.
  const aliasEntries = Object.entries(structure.aliases).sort(
    ([a], [b]) => b.length - a.length,
  );
  const dirKeys = Object.keys(structure.directories);
  const existing = new Set(files.map((f) => f.path));
  const claimed = new Set<string>();

  const moves: ReorgMove[] = [];
  const collisions: ReorgMove[] = [];
  const unclassified: string[] = [];
  let unchangedCount = 0;

  for (const file of files) {
    const alias = aliasEntries.find(([source]) => file.path.startsWith(source));

    if (!alias) {
      unchangedCount += 1;
      if (!dirKeys.some((dir) => file.path.startsWith(dir))) {
        unclassified.push(file.path);
      }
      continue;
    }

    const [source, canonical] = alias;
    const to = canonical + file.path.slice(source.length);

    if (to === file.path) {
      unchangedCount += 1;
      continue;
    }

    if (existing.has(to) || claimed.has(to)) {
      collisions.push({ from: file.path, to });
    } else {
      moves.push({ from: file.path, to });
      claimed.add(to);
    }
  }

  return { moves, collisions, unchangedCount, unclassified };
}
