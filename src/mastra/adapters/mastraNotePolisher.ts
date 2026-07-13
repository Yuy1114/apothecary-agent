import { notePolisher } from "../agents/transformers/note-polisher.js";
import { NotePolishDraftSchema } from "../../domain/notePolish.js";
import type { NotePolisher, RelatedExcerpt } from "../../application/ports/notePolisher.js";

function excerptBlock(excerpts: RelatedExcerpt[]): string {
  if (excerpts.length === 0) return "(none)";
  return excerpts.map((e) => `- ${e.path}:\n${e.excerpt}`).join("\n\n");
}

export const mastraNotePolisher: NotePolisher = {
  async polish({ notePath, noteBody, existingTags, modes, relatedExcerpts }) {
    const prompt = [
      `Note path: ${notePath}`,
      `Selected modes: ${modes.join(", ")}`,
      `Existing tags: ${existingTags.length ? existingTags.join(", ") : "(none)"}`,
      "",
      "Related note excerpts (expand-mode reference material):",
      excerptBlock(relatedExcerpts),
      "",
      "Note body to polish:",
      noteBody,
      "",
      "Polish the body per the selected modes. Output ONLY the structured fields.",
    ].join("\n");

    const result = await notePolisher.generate(prompt, {
      maxSteps: 1,
      toolChoice: "none",
      structuredOutput: { schema: NotePolishDraftSchema, jsonPromptInjection: "system" },
    });

    const draft = result.object;
    if (!draft) {
      throw new Error(`Note polisher returned no structured output (finishReason=${result.finishReason}).`);
    }
    // result.object is typed as the schema's input, where .default() keys are optional.
    return { ...draft, addTags: draft.addTags ?? [] };
  },
};
