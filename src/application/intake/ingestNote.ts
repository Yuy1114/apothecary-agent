import { promises as fs } from "node:fs";
import path from "node:path";
import { searchIndex } from "../ports/searchIndex.js";
import { INBOX_DIR } from "../../domain/vaultPolicy.js";
import { addReadmeEntry } from "../../vault/readmeIndex.js";
import { safeVaultPath } from "../../safety/pathSafety.js";
import { recordOperation, type OperationType } from "../../vault/operationLedger.js";
import { markSelfWrite } from "../../vault/selfWriteGuard.js";
import { commitSelfWrite } from "../../vault/syncSnapshot.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export function slugify(text: string): string {
  return text.replace(/[^\w一-鿿\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60);
}

/**
 * Sanitize a caller-supplied directory hint into a vault-relative POSIX
 * directory, or null when it cannot be one. Pure.
 *
 * The hint comes from an LLM (proposeChange's `topic` field), so it is treated
 * as untrusted: separators are normalized, a trailing slash is tolerated, and
 * anything that would escape the vault or name a file is rejected outright.
 * Whether the directory actually *exists* is not decided here — see
 * `writeVaultNote`, which refuses to invent one.
 */
export function normalizeTopicDir(topic: string | undefined): string | null {
  if (!topic) return null;
  const posix = topic.replaceAll("\\", "/").trim();
  const dir = posix.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!dir) return null;
  if (dir.split("/").some((segment) => segment === "." || segment === "..")) return null;
  if (dir.endsWith(".md")) return null;
  return dir;
}

/**
 * Human-readable label for a target directory, used in the note's frontmatter
 * and its README entry. Mirrors `updateReadmeForCreatedNote`'s fallback: the
 * last path segment, since the skeleton's directory names are already the
 * meaningful label. Pure.
 */
export function labelForDir(dir: string): string {
  if (dir === INBOX_DIR) return "未分类";
  return dir.split("/").filter(Boolean).at(-1) ?? dir;
}

/**
 * Resolve where a new note goes: an existing directory named by the hint,
 * otherwise the inbox. Never invents a directory — a hint naming somewhere that
 * is not on disk (a stale skeleton name, an LLM guess) lands in the inbox for
 * filing rather than growing a parallel tree beside the real one.
 */
async function resolveTargetDir(topic: string | undefined): Promise<string> {
  const hinted = normalizeTopicDir(topic);
  if (!hinted) return INBOX_DIR;
  const abs = safeVaultPath(VAULT_PATH, hinted);
  if (!abs) return INBOX_DIR;
  const stats = await fs.stat(abs).catch(() => null);
  return stats?.isDirectory() ? hinted : INBOX_DIR;
}

/**
 * Shared note-writing core: resolve target → write frontmatter'd file → update
 * the directory README → reindex → audit. Used by ingestVault and captureInsight.
 */
export async function writeVaultNote(params: {
  content: string;
  title?: string;
  topic?: string;
  noteType: "note" | "insight";
  source: string;
  operationType: OperationType;
}): Promise<{ filePath: string; topic: string; title: string; readmeUpdated: boolean }> {
  const dir = await resolveTargetDir(params.topic);
  const label = labelForDir(dir);

  const headingMatch = params.content.match(/^#\s+(.+)/m);
  const title =
    params.title ?? headingMatch?.[1] ?? params.content.split("\n")[0]?.slice(0, 60) ?? "untitled";
  // The target dir is either an existing directory or the inbox, and the
  // filename is slugified (no separators), so this is safe by construction —
  // guard anyway so no note-writing path can ever land outside the vault.
  const fileName = `${slugify(title)}.md`;
  const filePath = safeVaultPath(VAULT_PATH, path.join(dir, fileName));
  if (!filePath) throw new Error(`Refusing to write note outside the vault: ${dir}/${fileName}`);
  const dirPath = path.dirname(filePath);
  // The inbox is the one directory this writer may create; every other target
  // was proven to exist by resolveTargetDir. Creating directories freely here is
  // what let a stale "inbox" fallback materialize a whole parallel tree.
  if (dir === INBOX_DIR) await fs.mkdir(dirPath, { recursive: true });

  const relativePath = path.relative(VAULT_PATH, filePath);
  const readmePath = path.join(dirPath, "README.md");
  const relativeReadme = path.relative(VAULT_PATH, readmePath);

  const timestamp = new Date().toISOString().split("T")[0];
  const fileContent = `---\ntitle: "${title}"\ntopic: "${label}"\ncreated: ${timestamp}\ntype: ${params.noteType}\nsource: ${params.source}\n---\n\n${params.content}`;
  // Mark the note as the agent's own write BEFORE creating it: capture decides
  // the filename here (not at proposal time), so the caller can't pre-mark it,
  // and the slow reindex below opens a window the debounced watcher would catch
  // and re-flag as an external "created" change.
  markSelfWrite([relativePath]);
  await fs.writeFile(filePath, fileContent, "utf8");

  const dateLabel = new Date().toLocaleDateString("zh-CN");
  const existing = await fs.readFile(readmePath, "utf8").catch(() => null);
  const nextReadme = addReadmeEntry(existing, { title, fileName, date: dateLabel, label });
  const readmeUpdated = nextReadme !== existing;
  if (readmeUpdated) {
    markSelfWrite([relativeReadme]);
    await fs.writeFile(readmePath, nextReadme, "utf8");
  }

  await searchIndex().reindexFile(relativePath);
  // Fold both writes into the sync baseline (and release the marks) so neither
  // the watcher nor a later manual sync surfaces this note/README as external.
  await commitSelfWrite(VAULT_PATH, readmeUpdated ? [relativePath, relativeReadme] : [relativePath]);

  await recordOperation({
    type: params.operationType,
    targetFiles: [relativePath],
    rationale: title,
    source: params.source,
    detail: `topic: ${label}`,
  });

  return { filePath: relativePath, topic: label, title, readmeUpdated };
}
