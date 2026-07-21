/**
 * Pure consistency audit between a directory's `README.md` note index and the
 * notes actually present in that directory. The index is maintained incrementally
 * on note create/move (see updateReadmes.ts), so it drifts when a note is deleted
 * or moved outside that path (e.g. edited directly in Obsidian) or when an agent
 * write fails partway. This finds those drifts and rebuilds a corrected index,
 * touching only the `- [title](fileName)` list lines so any human prose survives.
 */

import { addReadmeEntry, removeReadmeEntry } from "./readmeIndex.js";

/** One parsed index line: the note it links to and the title shown for it. */
export type ReadmeIndexEntry = { title: string; fileName: string };

/** A note actually present in the directory (basename, current title, date). */
export type ActualNote = { fileName: string; title: string; date: string };

export type ReadmeIssueKind = "stale" | "missing" | "title_mismatch";

export type ReadmeIssue = {
  kind: ReadmeIssueKind;
  fileName: string;
  /** The title the README currently shows (stale / title_mismatch). */
  readmeTitle?: string;
  /** The note's real title (missing / title_mismatch). */
  actualTitle?: string;
};

const ENTRY_LINE = /^\s*-\s*\[([^\]]*)\]\(([^)]+)\)/;

/**
 * Extract the note-index entries from a README. Only local basename links (no
 * `/` and no scheme) count — an external link or a subfolder link is not an
 * index entry for this directory. Order-preserving; pure.
 */
export function parseReadmeEntries(content: string): ReadmeIndexEntry[] {
  const entries: ReadmeIndexEntry[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(ENTRY_LINE);
    if (!match) continue;
    const fileName = match[2].trim();
    if (!fileName || fileName.includes("/") || fileName.includes("://")) continue;
    entries.push({ title: match[1].trim(), fileName });
  }
  return entries;
}

/**
 * Compare a README's parsed entries against the notes actually in the directory:
 * - `stale` — listed in the README, but no such note on disk.
 * - `missing` — a note is present, but the README doesn't list it.
 * - `title_mismatch` — both present, but the shown title differs from the note's.
 * Deterministic, sorted by file then kind. Pure.
 */
export function auditReadme(input: { entries: ReadmeIndexEntry[]; actual: ActualNote[] }): ReadmeIssue[] {
  const actualByName = new Map(input.actual.map((note) => [note.fileName, note]));
  const entryByName = new Map(input.entries.map((entry) => [entry.fileName, entry]));
  const issues: ReadmeIssue[] = [];

  for (const entry of input.entries) {
    const note = actualByName.get(entry.fileName);
    if (!note) {
      issues.push({ kind: "stale", fileName: entry.fileName, readmeTitle: entry.title });
    } else if (note.title.trim() && entry.title.trim() !== note.title.trim()) {
      issues.push({ kind: "title_mismatch", fileName: entry.fileName, readmeTitle: entry.title, actualTitle: note.title });
    }
  }
  for (const note of input.actual) {
    if (!entryByName.has(note.fileName)) {
      issues.push({ kind: "missing", fileName: note.fileName, actualTitle: note.title });
    }
  }

  return issues.sort((a, b) => a.fileName.localeCompare(b.fileName) || a.kind.localeCompare(b.kind));
}

/**
 * Rebuild a corrected README from the current content and the audit issues,
 * editing only the index lines: drop stale links, add missing notes, and re-point
 * mismatched titles. Reuses the shared add/remove transforms so the format and
 * any surrounding human prose stay intact. Pure.
 */
export function reconcileReadme(input: {
  content: string | null;
  issues: ReadmeIssue[];
  actual: ActualNote[];
  /** Heading label used only if the README has to be scaffolded from nothing. */
  label: string;
}): string {
  const actualByName = new Map(input.actual.map((note) => [note.fileName, note]));
  let content = input.content ?? "";

  for (const issue of input.issues) {
    if (issue.kind === "stale") {
      content = removeReadmeEntry(content, issue.fileName);
      continue;
    }
    const note = actualByName.get(issue.fileName);
    if (!note) continue;
    if (issue.kind === "title_mismatch") content = removeReadmeEntry(content, issue.fileName);
    content = addReadmeEntry(content, { title: note.title, fileName: note.fileName, date: note.date, label: input.label });
  }

  return content;
}
