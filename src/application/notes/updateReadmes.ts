import { promises as fs } from "node:fs";
import path from "node:path";
import { addReadmeEntry, removeReadmeEntry } from "../../vault/readmeIndex.js";
import { parseMarkdownSnapshot } from "../../vault/markdown.js";
import { loadStructure } from "../../vault/structureStore.js";
import { markSelfWrite } from "../../vault/selfWriteGuard.js";
import { commitSelfWrite } from "../../vault/syncSnapshot.js";

/** Directory of a vault-relative path in POSIX form; "" for the vault root. */
function dirOf(relPath: string): string {
  const dir = path.posix.dirname(relPath.split(path.sep).join("/"));
  return dir === "." ? "" : dir;
}

function readmeAbs(vaultPath: string, dir: string): string {
  return path.join(vaultPath, dir, "README.md");
}

async function readOrNull(filePath: string): Promise<string | null> {
  return fs.readFile(filePath, "utf8").catch(() => null);
}

/** Add a newly-created Markdown note to its directory README index. */
export async function updateReadmeForCreatedNote(vaultPath: string, notePath: string): Promise<string | null> {
  if (!notePath.endsWith(".md") || path.posix.basename(notePath) === "README.md") return null;

  const dir = dirOf(notePath);
  const base = path.posix.basename(notePath);
  const noteContent = (await readOrNull(path.join(vaultPath, notePath))) ?? "";
  const title = parseMarkdownSnapshot(notePath, noteContent).title ?? base;
  const structure = await loadStructure();
  const structureKey = dir === "" ? "" : `${dir}/`;
  const fallbackLabel = dir === "" ? "笔记索引" : (dir.split("/").at(-1) ?? dir);
  const label = structure.directories[structureKey]?.description ?? fallbackLabel;
  const readmePath = readmeAbs(vaultPath, dir);
  const existing = await readOrNull(readmePath);
  const next = addReadmeEntry(existing, {
    title,
    fileName: base,
    date: new Date().toLocaleDateString("zh-CN"),
    label,
  });
  if (next === existing) return null;
  await fs.mkdir(path.dirname(readmePath), { recursive: true });
  const relativeReadme = path.posix.join(dir, "README.md");
  // This README write is an agent side-effect of applying a proposal — mark it so
  // the watcher does not surface it as an external change.
  markSelfWrite([relativeReadme]);
  await fs.writeFile(readmePath, next, "utf8");
  await commitSelfWrite(vaultPath, [relativeReadme]);
  return relativeReadme;
}

/**
 * Keep directory note-indexes consistent after a note moves: drop the entry from
 * the source directory's README and add it to the destination's (scaffolding one
 * if needed). Best-effort — a README problem must never fail the move itself.
 */
export async function updateReadmesForMove(vaultPath: string, from: string, to: string): Promise<void> {
  const fromDir = dirOf(from);
  const fromBase = path.posix.basename(from);

  // Remove the stale link from the source directory's index.
  const srcReadme = readmeAbs(vaultPath, fromDir);
  const srcContent = await readOrNull(srcReadme);
  if (srcContent != null) {
    const next = removeReadmeEntry(srcContent, fromBase);
    if (next !== srcContent) {
      const srcReadmeRel = path.posix.join(fromDir, "README.md");
      markSelfWrite([srcReadmeRel]);
      await fs.writeFile(srcReadme, next, "utf8");
      await commitSelfWrite(vaultPath, [srcReadmeRel]);
    }
  }

  // Add the note to the destination directory's index.
  await updateReadmeForCreatedNote(vaultPath, to);
}
