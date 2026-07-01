import { promises as fs } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export type DirectoryDef = {
  description: string;
  keywords?: string[];
};

export type VaultStructure = {
  directories: Record<string, DirectoryDef>;
};

let cache: VaultStructure | null = null;

export async function loadStructure(): Promise<VaultStructure> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(path.join(VAULT_PATH, ".agent", "structure.yaml"), "utf8");
    cache = parse(raw) as VaultStructure;
    return cache!;
  } catch {
    return { directories: {} };
  }
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
