import { z } from "zod";

/**
 * Note polishing: an LLM rewrite of a single note's body, scoped by the
 * user-selected modes. The draft is the model's half only — the final file
 * (frontmatter + body) is assembled deterministically by the use case, and the
 * result always lands as an `edit` proposal, never a direct write.
 */
export const PolishModeSchema = z.enum(["expand", "format", "tags", "condense"]);
export type PolishMode = z.infer<typeof PolishModeSchema>;

/** Lean draft schema fed to structuredOutput: only the model-generated fields. */
export const NotePolishDraftSchema = z.object({
  /** The polished note body, without any frontmatter block. */
  body: z.string().min(1),
  /** Tags to merge into the note's frontmatter; ignored unless "tags" is selected. */
  addTags: z.array(z.string()).default([]),
  /** One-sentence description of what changed, shown to the reviewer. */
  changeSummary: z.string().min(1),
});
export type NotePolishDraft = z.infer<typeof NotePolishDraftSchema>;

/**
 * Without "expand" selected a polish must roughly preserve length; below this
 * ratio of the original body it is treated as content loss and rejected.
 */
export const MIN_BODY_RATIO = 0.7;

export type PolishDraftValidation =
  | { ok: true; draft: NotePolishDraft }
  | { ok: false; reason: "empty_body" | "body_shrunk" };

/**
 * Guard an LLM polish draft before it becomes a proposal. The edit executor
 * writes `suggestedContent` verbatim (and its schema even allows an empty
 * string), so content-loss protection has to happen here, on the generating
 * side: reject empty bodies, reject silent shrinkage when the user did not ask
 * for a rewrite that grows the note, and drop tags the user did not ask for.
 */
export function validatePolishDraft(
  originalBody: string,
  draft: NotePolishDraft,
  modes: PolishMode[],
): PolishDraftValidation {
  const polished = draft.body.trim();
  if (!polished) return { ok: false, reason: "empty_body" };
  // Expand grows on purpose; condense shrinks on purpose (its guard is the
  // human reviewing the proposal diff). Only a mode that promised to preserve
  // content is held to the ratio.
  if (
    !modes.includes("expand") &&
    !modes.includes("condense") &&
    polished.length < originalBody.trim().length * MIN_BODY_RATIO
  ) {
    return { ok: false, reason: "body_shrunk" };
  }
  const addTags = modes.includes("tags")
    ? draft.addTags.map((tag) => tag.trim()).filter(Boolean)
    : [];
  return { ok: true, draft: { ...draft, addTags } };
}
