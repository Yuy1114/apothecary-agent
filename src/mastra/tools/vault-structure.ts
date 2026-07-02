import { promises as fs } from "node:fs";
import path from "node:path";
import { parse, parseDocument } from "yaml";
import { recordOperation } from "../../vault/operationLedger.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export type DirectoryDef = {
  description: string;
  keywords?: string[];
};

export type VaultStructure = {
  directories: Record<string, DirectoryDef>;
  // Source-prefix → canonical-prefix. Used to canonicalize alias directories
  // (e.g. "notes/programming/dsa/" → "notes/programming/Data Structures & Algorithms/").
  aliases: Record<string, string>;
};

let cache: VaultStructure | null = null;

export async function loadStructure(): Promise<VaultStructure> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(path.join(VAULT_PATH, ".agent", "structure.yaml"), "utf8");
    const parsed = (parse(raw) ?? {}) as Partial<VaultStructure>;
    cache = {
      directories: parsed.directories ?? {},
      aliases: parsed.aliases ?? {},
    };
    return cache;
  } catch {
    return { directories: {}, aliases: {} };
  }
}

export type KeywordEdit = {
  directory: string;
  add?: string[];
  remove?: string[];
};

export type KeywordEditResult = {
  directory: string;
  keywords: string[];
  conflicts: string[];
};

const normalizeKeyword = (kw: string): string => kw.trim().toLowerCase();

/**
 * Pure structure.yaml keyword edit: add/remove keywords for an existing
 * directory while preserving the file's comments and layout. Returns the new
 * YAML text, the resulting keyword list, and any added keyword that already
 * belongs to another directory (a classification conflict to surface).
 */
export function applyKeywordEdit(rawYaml: string, edit: KeywordEdit): { yaml: string } & KeywordEditResult {
  const doc = parseDocument(rawYaml);
  if (doc.getIn(["directories", edit.directory]) === undefined) {
    throw new Error(`Directory "${edit.directory}" is not defined in structure.yaml.`);
  }

  const plain = (parse(rawYaml) ?? {}) as Partial<VaultStructure>;
  const directories = plain.directories ?? {};

  const currentNode = doc.getIn(["directories", edit.directory, "keywords"]);
  const current: string[] =
    currentNode && typeof (currentNode as { toJSON?: () => unknown }).toJSON === "function"
      ? ((currentNode as { toJSON: () => unknown }).toJSON() as string[])
      : Array.isArray(currentNode)
        ? (currentNode as string[])
        : [];

  const additions = (edit.add ?? []).map((kw) => kw.trim()).filter(Boolean);
  const removals = new Set((edit.remove ?? []).map(normalizeKeyword));

  const conflicts: string[] = [];
  for (const kw of additions) {
    const clashesElsewhere = Object.entries(directories).some(
      ([dir, def]) =>
        dir !== edit.directory && def.keywords?.some((k) => normalizeKeyword(k) === normalizeKeyword(kw)),
    );
    if (clashesElsewhere) conflicts.push(kw);
  }

  const keywords = current.filter((k) => !removals.has(normalizeKeyword(k)));
  for (const kw of additions) {
    if (!keywords.some((k) => normalizeKeyword(k) === normalizeKeyword(kw))) keywords.push(kw);
  }

  doc.setIn(["directories", edit.directory, "keywords"], keywords);
  return { yaml: doc.toString(), directory: edit.directory, keywords, conflicts };
}

/**
 * Persist a keyword edit to structure.yaml and invalidate the load cache so the
 * next classification uses the updated rules.
 */
export async function updateDirectoryKeywords(edit: KeywordEdit): Promise<KeywordEditResult> {
  const structurePath = path.join(VAULT_PATH, ".agent", "structure.yaml");
  const raw = await fs.readFile(structurePath, "utf8");
  const { yaml, directory, keywords, conflicts } = applyKeywordEdit(raw, edit);
  await fs.writeFile(structurePath, yaml, "utf8");
  cache = null;

  await recordOperation({
    type: "structure",
    targetFiles: [".agent/structure.yaml"],
    source: "updateStructureKeywords",
    detail: `${directory}: +[${(edit.add ?? []).join(", ")}] -[${(edit.remove ?? []).join(", ")}]`,
  });

  return { directory, keywords, conflicts };
}

export function classifyWithStructure(content: string, structure: VaultStructure): { dir: string; label: string } {
  const lower = content.toLowerCase();
  let best = { dir: "inbox", label: "未分类", score: 0 };

  for (const [dir, def] of Object.entries(structure.directories)) {
    if (!def.keywords) continue;
    const hits = def.keywords.filter((kw) => lower.includes(kw)).length;
    if (hits > best.score) best = { dir, label: def.description, score: hits };
    if (lower.includes(dir.toLowerCase())) {
      best = { dir, label: def.description, score: Math.max(best.score, 10) };
    }
  }

  return best;
}
