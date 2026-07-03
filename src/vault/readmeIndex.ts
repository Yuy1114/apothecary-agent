/**
 * Pure transforms for a directory's `README.md` note index — the human-readable
 * list of notes in a folder, formatted as `- [title](fileName) — date`. Shared
 * by note creation (writeVaultNote) and moves so the index format stays uniform.
 */

export type ReadmeEntry = {
  title: string;
  /** Link target: the note's basename within the directory, e.g. "redis.md". */
  fileName: string;
  date: string;
  /** Heading label used only when scaffolding a brand-new README. */
  label: string;
};

function entryLine(entry: ReadmeEntry): string {
  return `- [${entry.title}](${entry.fileName}) — ${entry.date}\n`;
}

/** Match the markdown link form so "a.md" never matches inside "aaa.md". */
function linkTarget(fileName: string): string {
  return `](${fileName})`;
}

/**
 * Add an entry to a directory README, creating the scaffold if there is none.
 * Idempotent: if the file is already listed (by link target), returns the
 * content unchanged.
 */
export function addReadmeEntry(content: string | null | undefined, entry: ReadmeEntry): string {
  const line = entryLine(entry);
  if (!content || content.trim() === "") {
    return `# ${entry.label}\n\n## 笔记索引\n\n${line}`;
  }
  if (content.includes(linkTarget(entry.fileName))) return content;
  return content.endsWith("\n") ? content + line : `${content}\n${line}`;
}

/**
 * Remove the index line linking to `fileName` from a README. Only list items
 * (`- ...`) that link to that exact target are dropped; other lines mentioning
 * the name are left intact. Returns the content unchanged if nothing matched.
 */
export function removeReadmeEntry(content: string, fileName: string): string {
  const target = linkTarget(fileName);
  const lines = content.split("\n");
  const kept = lines.filter((line) => !(line.trimStart().startsWith("-") && line.includes(target)));
  return kept.join("\n");
}
