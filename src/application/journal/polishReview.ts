import { promises as fs } from "node:fs";
import { safeVaultPath } from "../../safety/pathSafety.js";
import { createProposal } from "../../vault/proposalStore.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";
import { validatePolishDraft } from "../../domain/notePolish.js";
import {
  LOG_SECTION,
  REVIEW_SECTION,
  digestRelPath,
  replaceSectionBody,
  sectionBody,
  type Cadence,
} from "../../domain/journal.js";
import { readPeriod } from "./journalStore.js";
import type { NotePolisher, RelatedExcerpt } from "../ports/notePolisher.js";

export type PolishReviewMode = "expand" | "condense";

export type PolishReviewResult = {
  proposalId: string;
  changeSummary: string;
};

const EXCERPT_CHARS = 1500;

/**
 * Section-scoped polish of a period's 复盘 — the "user-delegated exception" to
 * journal/'s no-edit-body protection: only the review section the human asked
 * about is rewritten, the untouched rest of the note is carried byte-for-byte,
 * and the result always lands as an `edit` proposal for the human to diff.
 *
 * Expand grounds itself in the period's own record — the machine-written
 * activity digest and the note's 日志 section — not in vector search: a review
 * grows from what actually happened, not from lookalike notes.
 */
export async function polishReview(
  input: { vaultPath: string; cadence: Cadence; key: string; mode: PolishReviewMode },
  polisher: NotePolisher,
): Promise<PolishReviewResult> {
  const { vaultPath, cadence, key, mode } = input;
  const note = await readPeriod(vaultPath, cadence, key);
  if (!note.exists || note.content === null) throw new Error("note_missing");

  const reviewBody = sectionBody(note.content, REVIEW_SECTION);
  if (!reviewBody) throw new Error("review_empty");

  const relatedExcerpts: RelatedExcerpt[] = [];
  if (mode === "expand") {
    const digestPath = digestRelPath(cadence, key);
    const digestAbs = safeVaultPath(vaultPath, digestPath);
    const digest = digestAbs ? await fs.readFile(digestAbs, "utf8").catch(() => null) : null;
    if (digest) relatedExcerpts.push({ path: digestPath, excerpt: digest.slice(0, EXCERPT_CHARS) });
    const log = sectionBody(note.content, LOG_SECTION);
    if (log) relatedExcerpts.push({ path: `${note.relPath}#${LOG_SECTION}`, excerpt: log.slice(0, EXCERPT_CHARS) });
  }

  const draft = await polisher.polish({
    notePath: note.relPath,
    noteBody: reviewBody,
    existingTags: [],
    modes: [mode],
    relatedExcerpts,
  });

  const checked = validatePolishDraft(reviewBody, draft, [mode]);
  if (!checked.ok) throw new Error(`polish_rejected:${checked.reason}`);

  const suggestedContent = replaceSectionBody(note.content, REVIEW_SECTION, checked.draft.body);
  if (suggestedContent === null) throw new Error("review_empty"); // section vanished mid-flight

  const proposal = await createProposal(apothecaryHome(), {
    type: "edit",
    title: `润色复盘：${key}`,
    rationale: checked.draft.changeSummary,
    payload: { filePath: note.relPath, suggestedContent },
  });

  return { proposalId: proposal.id, changeSummary: checked.draft.changeSummary };
}
