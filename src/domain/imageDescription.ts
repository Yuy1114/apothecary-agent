import { z } from "zod";

/**
 * What a vision model is asked to report about one image, shaped for a filing
 * decision rather than for captioning: the organizer needs to know what kind of
 * thing this is, what it says, and what to call it.
 *
 * Language follows the layer convention. `description` and `kind` are
 * agent-internal understanding and are pinned to English, like every other
 * semantic-layer field. `text` is verbatim — translating what is written in an
 * image would be lossy and would defeat the point of reading it. `suggestedName`
 * becomes a real filename in a Chinese vault, so it follows the image's own
 * language.
 */

export const ImageKindSchema = z.enum([
  "screenshot_ui",
  "screenshot_code",
  "screenshot_chat",
  "document_scan",
  "receipt_or_form",
  "diagram_or_chart",
  "whiteboard_or_handwriting",
  "photo",
  "artwork_or_meme",
  "other",
]);
export type ImageKind = z.infer<typeof ImageKindSchema>;

export const ImageDescriptionDraftSchema = z.object({
  kind: ImageKindSchema.describe("What sort of image this is, for placement"),
  description: z
    .string()
    .min(1)
    .describe("One or two sentences in ENGLISH: what it shows and what it is for"),
  text: z
    .string()
    .default("")
    .describe("Text visible in the image, verbatim and in its original language; empty if none"),
  suggestedName: z
    .string()
    .default("")
    .describe(
      "A clean, human-readable filename stem (no extension) in the image's own language; empty if unsure",
    ),
});
export type ImageDescriptionDraft = z.infer<typeof ImageDescriptionDraftSchema>;

/**
 * Filename characters that break links, shells or Finder, plus the C0 control
 * range — a model can emit a stray newline or NUL, and either makes a path that
 * some tools accept and others refuse. Spaces and hyphens are deliberately kept:
 * they are ordinary in names, and stripping them would mangle the dates these
 * suggestions usually carry (`电费账单 2026-07`).
 */
const UNSAFE_NAME = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * Make a model-suggested stem safe to use as a filename. Returns `null` when
 * nothing usable survives, so the caller keeps the original name rather than
 * inventing one. Pure.
 */
export function sanitizeSuggestedName(suggested: string, maxLength = 60): string | null {
  const cleaned = suggested
    .replace(UNSAFE_NAME, " ")
    .replace(/\s+/g, " ")
    // A leading dot would hide the file; trailing dots break on some filesystems.
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, maxLength)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Render a description as the excerpt the organizer reads. */
export function renderImageDescription(draft: ImageDescriptionDraft): string {
  const lines = [`[${draft.kind}] ${draft.description}`];
  if (draft.text.trim()) lines.push("", "文字内容：", draft.text.trim());
  return lines.join("\n");
}
