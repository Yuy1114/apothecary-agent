import { promises as fs } from "node:fs";
import path from "node:path";
import { nowIso } from "../utils/time.js";
import {
  classifyFileKind,
  isJunkName,
  isPackageDir,
  summarizeExtensions,
  type InboxEntry,
  type InboxSurvey,
} from "../domain/inboxSurvey.js";

const INBOX = "_inbox";
const DIR_WALK_CAP = 2000;
const SAMPLE_SIZE = 8;
const JUNK_SAMPLE_SIZE = 6;

/**
 * Build a content-free survey of `<vault>/_inbox`: one entry per top-level item,
 * directories folded to a bounded summary. Junk (OS noise) is counted and
 * sampled but excluded from `entries` so the organizer can dispose of it by rule
 * rather than one at a time. Read-only; never reads file contents.
 */
export async function surveyInbox(vaultPath: string): Promise<InboxSurvey> {
  const inboxAbs = path.join(vaultPath, INBOX);
  const dirents = await fs.readdir(inboxAbs, { withFileTypes: true }).catch(() => []);

  const entries: InboxEntry[] = [];
  const junkSample: string[] = [];
  let junk = 0;
  let total = 0;

  for (const dirent of dirents) {
    const name = dirent.name;
    total += 1;
    const rel = `${INBOX}/${name}`;
    const abs = path.join(inboxAbs, name);

    if (isJunkName(name)) {
      junk += 1;
      if (junkSample.length < JUNK_SAMPLE_SIZE) junkSample.push(name);
      continue;
    }

    if (dirent.isDirectory()) {
      if (isPackageDir(name)) {
        entries.push({ name, path: rel, kind: "package" });
      } else {
        const folded = await foldDirectory(abs);
        entries.push({ name, path: rel, kind: "directory", ...folded });
      }
      continue;
    }

    const stat = await fs.stat(abs).catch(() => null);
    entries.push({
      name,
      path: rel,
      kind: classifyFileKind(name),
      sizeBytes: stat?.size ?? 0,
      ext: path.extname(name).toLowerCase() || undefined,
    });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));

  return { root: INBOX, scannedAt: nowIso(), total, junk, junkSample, entries };
}

/**
 * Bounded recursive summary of a directory: total file count, dominant
 * extensions, and a small name sample — without emitting every child. Nested
 * packages count as one file and aren't descended into; junk is skipped.
 */
async function foldDirectory(
  absDir: string,
): Promise<{ fileCount: number; topExtensions: { ext: string; count: number }[]; sample: string[]; truncated: boolean }> {
  const childNames: string[] = [];
  const sample: string[] = [];
  let fileCount = 0;
  let truncated = false;
  const stack = [absDir];

  while (stack.length > 0 && !truncated) {
    const dir = stack.pop()!;
    const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const dirent of dirents) {
      if (isJunkName(dirent.name)) continue;
      if (dirent.isDirectory() && !isPackageDir(dirent.name)) {
        stack.push(path.join(dir, dirent.name));
        continue;
      }
      // A file, or an opaque package dir counted as a single unit.
      fileCount += 1;
      childNames.push(dirent.name);
      if (sample.length < SAMPLE_SIZE) sample.push(dirent.name);
      if (fileCount >= DIR_WALK_CAP) {
        truncated = true;
        break;
      }
    }
  }

  return { fileCount, topExtensions: summarizeExtensions(childNames), sample, truncated };
}
