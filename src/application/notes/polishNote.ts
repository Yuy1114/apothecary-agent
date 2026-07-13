import path from "node:path";
import { searchIndex, type SearchHit } from "../ports/searchIndex.js";
import type { NotePolisher, RelatedExcerpt } from "../ports/notePolisher.js";
import { validatePolishDraft, type PolishMode } from "../../domain/notePolish.js";
import { readVaultText } from "../../vault/readText.js";
import { parseMarkdownSnapshot } from "../../vault/markdown.js";
import { addFrontmatterTagsPreserving, getFrontmatterKey } from "../../vault/frontmatter.js";
import { createProposal } from "../../vault/proposalStore.js";
import { safeVaultPath } from "../../safety/pathSafety.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";

export type PolishNoteResult = {
  proposalId: string;
  filePath: string;
  modes: PolishMode[];
  changeSummary: string;
};

const RELATED_QUERY_TOP_K = 8;
const RELATED_CONTEXT_LIMIT = 5;
const RELATED_EXCERPT_CHARS = 500;

/**
 * Split the raw frontmatter block (if any) from the body, preserving the block
 * byte-for-byte. gray-matter would re-serialize the YAML on stringify; a polish
 * that doesn't touch tags must not reformat frontmatter the user wrote.
 */
function splitFrontmatterBlock(content: string): { block: string; body: string } {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content);
  if (!match) return { block: "", body: content };
  return { block: match[0], body: content.slice(match[0].length) };
}

/**
 * Polish one vault note per the user-selected modes and record the result as an
 * `edit` proposal for review. Never writes the note itself — the approved
 * proposal's executor owns the write, reindex, ledger and semantic re-sync.
 *
 * The LLM produces only the body and tag suggestions; the frontmatter is
 * carried over deterministically so keys like `created`/`source`/`superseded_by`
 * can never be mangled by the model.
 */
export async function polishNote(
  input: { vaultPath: string; filePath: string; modes: PolishMode[] },
  polisher: NotePolisher,
): Promise<PolishNoteResult> {
  const { vaultPath, filePath } = input;
  const modes = [...new Set(input.modes)];
  if (modes.length === 0) throw new Error("no_modes");
  if (!/\.md$/i.test(filePath)) throw new Error("unsupported_text_type");
  if (!safeVaultPath(vaultPath, filePath)) throw new Error("unsafe_path");
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  // The edit executor only checks vault escape; keep agent-internal trees out of
  // reach of a polish regardless.
  if (normalized.startsWith(".agent/") || normalized.startsWith(".apothecary/")) {
    throw new Error("agent_internal_path");
  }

  const { content } = await readVaultText(vaultPath, filePath);
  const { block: frontmatterBlock, body: originalBody } = splitFrontmatterBlock(content);
  const rawTags = getFrontmatterKey(content, "tags");
  const existingTags = Array.isArray(rawTags) ? rawTags.map(String) : [];

  const relatedExcerpts = modes.includes("expand")
    ? await findRelatedExcerpts(filePath, content)
    : [];

  const draft = await polisher.polish({
    notePath: normalized,
    noteBody: originalBody,
    existingTags,
    modes,
    relatedExcerpts,
  });

  const checked = validatePolishDraft(originalBody, draft, modes);
  if (!checked.ok) throw new Error(`polish_rejected:${checked.reason}`);

  const body = checked.draft.body.endsWith("\n") ? checked.draft.body : `${checked.draft.body}\n`;
  const suggestedContent = addFrontmatterTagsPreserving(frontmatterBlock + body, checked.draft.addTags);

  const proposal = await createProposal(apothecaryHome(), {
    type: "edit",
    title: `润色：${path.posix.basename(normalized)}`,
    rationale: checked.draft.changeSummary,
    payload: { filePath, suggestedContent },
  });

  return {
    proposalId: proposal.id,
    filePath,
    modes,
    changeSummary: checked.draft.changeSummary,
  };
}

/**
 * Best-effort retrieval of related notes for expand mode: the note itself and
 * superseded notes are excluded. A dead embedding endpoint must degrade to a
 * context-free polish, not fail the run (see the intake embedding-hang fix).
 */
async function findRelatedExcerpts(filePath: string, content: string): Promise<RelatedExcerpt[]> {
  const snapshot = parseMarkdownSnapshot(filePath, content);
  const query = [snapshot.title, snapshot.excerpt.slice(0, 200)].filter(Boolean).join("\n");

  let hits: SearchHit[];
  try {
    hits = await searchIndex().queryVault(query, RELATED_QUERY_TOP_K);
  } catch {
    return [];
  }

  return hits
    .filter((hit) => hit.source !== filePath && !hit.supersededBy)
    .slice(0, RELATED_CONTEXT_LIMIT)
    .map((hit) => ({ path: hit.source, excerpt: hit.content.slice(0, RELATED_EXCERPT_CHARS) }));
}
