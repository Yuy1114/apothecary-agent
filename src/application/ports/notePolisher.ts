import type { NotePolishDraft, PolishMode } from "../../domain/notePolish.js";

/** One related note's excerpt, handed to the polisher as expand-mode context. */
export type RelatedExcerpt = {
  path: string;
  excerpt: string;
};

/**
 * Rewrites a note's body according to the user-selected polish modes. Passed in
 * by the caller — every caller of polishNote lives in mastra (tool, workflow)
 * or the desktop composition root, so no registry is warranted.
 */
export interface NotePolisher {
  polish(input: {
    notePath: string;
    /** The note's body without its frontmatter block. */
    noteBody: string;
    existingTags: string[];
    modes: PolishMode[];
    relatedExcerpts: RelatedExcerpt[];
  }): Promise<NotePolishDraft>;
}
