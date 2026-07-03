import { promises as fs } from "node:fs";
import path from "node:path";
import { reindexFile } from "./rag.js";
import { loadStructure, classifyWithStructure, type VaultStructure } from "./vault-structure.js";
import { addReadmeEntry } from "../../vault/readmeIndex.js";
import { safeVaultPath } from "../../safety/pathSafety.js";
import { recordOperation, type OperationType } from "../../vault/operationLedger.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export function slugify(text: string): string {
  return text.replace(/[^\w一-鿿\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60);
}

/**
 * Decide the target directory + label for new content: an exact/keyword topic
 * hint wins, otherwise classify by content, otherwise fall back to inbox. Pure.
 */
export function resolveIngestDir(
  structure: VaultStructure,
  input: { topic?: string; content: string },
): { dir: string; label: string } {
  let dir = "inbox";
  let label = "未分类";

  if (input.topic) {
    if (structure.directories[input.topic]) {
      dir = input.topic;
      label = structure.directories[input.topic].description;
    } else {
      for (const [d, def] of Object.entries(structure.directories)) {
        if (!def.keywords) continue;
        if (def.keywords.some((kw) => input.topic!.toLowerCase().includes(kw))) {
          dir = d;
          label = def.description;
          break;
        }
      }
    }
  }

  if (dir === "inbox") {
    ({ dir, label } = classifyWithStructure(input.content, structure));
  }

  return { dir, label };
}

/**
 * Shared note-writing core: classify → write frontmatter'd file → update the
 * directory README → reindex → audit. Used by ingestVault and captureInsight.
 */
export async function writeVaultNote(params: {
  content: string;
  title?: string;
  topic?: string;
  noteType: "note" | "insight";
  source: string;
  operationType: OperationType;
}): Promise<{ filePath: string; topic: string; title: string; readmeUpdated: boolean }> {
  const structure = await loadStructure();
  const { dir, label } = resolveIngestDir(structure, { topic: params.topic, content: params.content });

  const headingMatch = params.content.match(/^#\s+(.+)/m);
  const title =
    params.title ?? headingMatch?.[1] ?? params.content.split("\n")[0]?.slice(0, 60) ?? "untitled";
  // The target dir comes from the structure (or inbox) and the filename is
  // slugified (no separators), so this is safe by construction — guard anyway so
  // no note-writing path can ever land outside the vault.
  const fileName = `${slugify(title)}.md`;
  const filePath = safeVaultPath(VAULT_PATH, path.join(dir, fileName));
  if (!filePath) throw new Error(`Refusing to write note outside the vault: ${dir}/${fileName}`);
  const dirPath = path.dirname(filePath);
  await fs.mkdir(dirPath, { recursive: true });

  const timestamp = new Date().toISOString().split("T")[0];
  const fileContent = `---\ntitle: "${title}"\ntopic: "${label}"\ncreated: ${timestamp}\ntype: ${params.noteType}\nsource: ${params.source}\n---\n\n${params.content}`;
  await fs.writeFile(filePath, fileContent, "utf8");

  const readmePath = path.join(dirPath, "README.md");
  const dateLabel = new Date().toLocaleDateString("zh-CN");
  const existing = await fs.readFile(readmePath, "utf8").catch(() => null);
  const nextReadme = addReadmeEntry(existing, { title, fileName, date: dateLabel, label });
  const readmeUpdated = nextReadme !== existing;
  if (readmeUpdated) await fs.writeFile(readmePath, nextReadme, "utf8");

  const relativePath = path.relative(VAULT_PATH, filePath);
  await reindexFile(relativePath);

  await recordOperation({
    type: params.operationType,
    targetFiles: [relativePath],
    rationale: title,
    source: params.source,
    detail: `topic: ${label}`,
  });

  return { filePath: relativePath, topic: label, title, readmeUpdated };
}
