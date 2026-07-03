import { promises as fs } from "node:fs";
import path from "node:path";
import { addReadmeEntry, removeReadmeEntry } from "../../vault/readmeIndex.js";
import { parseMarkdownSnapshot } from "../../vault/markdown.js";
import { loadStructure } from "./vault-structure.js";

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

/**
 * Keep directory note-indexes consistent after a note moves: drop the entry from
 * the source directory's README and add it to the destination's (scaffolding one
 * if needed). Best-effort — a README problem must never fail the move itself.
 */
export async function updateReadmesForMove(vaultPath: string, from: string, to: string): Promise<void> {
  const fromDir = dirOf(from);
  const toDir = dirOf(to);
  const fromBase = path.posix.basename(from);
  const toBase = path.posix.basename(to);

  // Remove the stale link from the source directory's index.
  const srcReadme = readmeAbs(vaultPath, fromDir);
  const srcContent = await readOrNull(srcReadme);
  if (srcContent != null) {
    const next = removeReadmeEntry(srcContent, fromBase);
    if (next !== srcContent) await fs.writeFile(srcReadme, next, "utf8");
  }

  // Add the note to the destination directory's index.
  const movedContent = (await readOrNull(path.join(vaultPath, to))) ?? "";
  const title = parseMarkdownSnapshot(to, movedContent).title ?? toBase;
  const structure = await loadStructure();
  const structureKey = toDir === "" ? "" : `${toDir}/`;
  const fallbackLabel = toDir === "" ? "笔记索引" : (toDir.split("/").at(-1) ?? toDir);
  const label = structure.directories[structureKey]?.description ?? fallbackLabel;
  const date = new Date().toLocaleDateString("zh-CN");

  const destReadme = readmeAbs(vaultPath, toDir);
  const destContent = await readOrNull(destReadme);
  const nextDest = addReadmeEntry(destContent, { title, fileName: toBase, date, label });
  if (nextDest !== destContent) {
    await fs.mkdir(path.dirname(destReadme), { recursive: true });
    await fs.writeFile(destReadme, nextDest, "utf8");
  }
}
