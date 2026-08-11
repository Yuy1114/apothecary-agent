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

/**
 * Tolerant view of what a vision model actually returns. An unrecognised `kind`
 * degrades to `other` instead of failing the whole read — the description and
 * the transcribed text are what the filing decision rests on, and losing them
 * over an unexpected label would be a bad trade.
 */
const ImageDescriptionResponseSchema = z.object({
  kind: ImageKindSchema.catch("other"),
  description: z.string().default(""),
  text: z.string().default(""),
  suggestedName: z.string().default(""),
});

/** The JSON object the model is asked to produce, spelled out for the prompt. */
export function imageDescriptionJsonSpec(): string {
  return [
    "{",
    `  "kind": one of ${ImageKindSchema.options.map((k) => `"${k}"`).join(" | ")},`,
    '  "description": "one or two sentences in ENGLISH",',
    '  "text": "text visible in the image, verbatim and in its original language ("" if none)",',
    '  "suggestedName": "a short filename stem in the image\'s own language, no extension ("" if unsure)"',
    "}",
  ].join("\n");
}

/**
 * Parse a model's JSON reply. Tolerates the markdown fence models like to wrap
 * JSON in, and prose around it. Throws when nothing usable comes back, so the
 * caller reports a failed read rather than filing on an empty description. Pure.
 */
export function parseImageDescription(raw: string): ImageDescriptionDraft {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  // A model that adds a sentence around the object is still usable.
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("vision_response_not_json");

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    throw new Error("vision_response_not_json");
  }

  const result = ImageDescriptionResponseSchema.safeParse(parsed);
  if (!result.success || !result.data.description.trim()) {
    throw new Error("vision_response_unusable");
  }
  return result.data;
}

/** Render a description as the excerpt the organizer reads. */
export function renderImageDescription(draft: ImageDescriptionDraft): string {
  const lines = [`[${draft.kind}] ${draft.description}`];
  if (draft.text.trim()) lines.push("", "文字内容：", draft.text.trim());
  return lines.join("\n");
}

/**
 * The searchable document standing in for an image in the vector index.
 *
 * An image has no text of its own, so what gets embedded is what the vision
 * model saw. Written as Markdown because the indexer chunks Markdown — the H1
 * becomes the hit's title, so a search result names the picture rather than
 * showing a path. The transcription carries most of the retrieval value (asking
 * for "那张讲 Redis 过期策略的截图" matches words that were *in* the screenshot),
 * so it is included verbatim rather than summarised away. Pure.
 */
export function imageSearchDocument(input: {
  path: string;
  draft: ImageDescriptionDraft;
}): string {
  const { path: filePath, draft } = input;
  const fileName = filePath.split("/").filter(Boolean).at(-1) ?? filePath;
  const title = draft.suggestedName.trim() || fileName;

  const lines = [`# ${title}`, "", `图片：${filePath}`, `类型：${draft.kind}`, "", draft.description];
  if (draft.text.trim()) lines.push("", "## 图中文字", "", draft.text.trim());
  return lines.join("\n");
}
