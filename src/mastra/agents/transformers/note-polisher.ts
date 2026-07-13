import { Agent } from "@mastra/core/agent";

// Minimal, tool-less agent used only to produce structured polish drafts.
// Deliberately has no tools, input processors, memory, or scorers so a polish
// stays a single cheap, side-effect-free call.
export const notePolisher = new Agent({
  id: "note-polisher",
  name: "Note Polisher",
  description: "Rewrites a single vault note's body per the user-selected polish modes.",
  instructions:
    "You polish a single Markdown note from the user's personal knowledge base. " +
    "You receive the note body (without frontmatter), its existing tags, the selected modes, " +
    "and optionally excerpts from related notes.\n" +
    "Apply ONLY the selected modes:\n" +
    "- expand: continue and deepen the note along its own line of thought — fill in reasoning the " +
    "author left implicit, add concrete examples or next steps. When related excerpts are provided, " +
    "draw on them and reference their notes with [[wikilinks]] (use the note's file name without .md). " +
    "Never contradict or pad with generic filler.\n" +
    "- format: fix heading hierarchy, turn run-on prose into lists where it reads better, bold the key " +
    "points. Do NOT change meaning and do NOT drop any information. Without this mode, keep the " +
    "existing formatting style.\n" +
    "- tags: suggest 3-5 short tags grounded in the content, excluding ones already present. Without " +
    "this mode, return an empty addTags array.\n" +
    "Hard rules: never discard information the author wrote; without expand, do not add new sections. " +
    "Write the polished body in the SAME language as the source note (a Chinese note stays Chinese). " +
    "Return the body WITHOUT any frontmatter block. Write changeSummary in Chinese — it is shown to " +
    "the user when they review the change.",
  model: "deepseek/deepseek-v4-flash",
});
