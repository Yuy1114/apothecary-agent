import path from "node:path";
import { extractDocumentText } from "../../vault/extractText.js";
import { safeVaultPath } from "../../safety/pathSafety.js";
import { IMAGE_EXTS } from "../../domain/inboxSurvey.js";
import { renderImageDescription, sanitizeSuggestedName } from "../../domain/imageDescription.js";
import { imageDescriber } from "../ports/imageDescriber.js";

/**
 * One way in for "tell me what this inbox item actually is", whatever it is.
 *
 * Documents go through text extraction; images go through a vision model when
 * one is configured. Keeping the two behind a single call means the organizer's
 * tool does not have to know which formats are readable by which mechanism —
 * and when no vision model is configured, an image simply reports that, rather
 * than failing the intake pass.
 */

export type InboxDocument = {
  filePath: string;
  /** How the content was recovered: an extractor name, or `vision`. */
  via: string;
  excerpt: string;
  lineCount: number;
  truncated: boolean;
  units?: number;
  /** From a vision read: a cleaner filename the organizer may adopt. */
  suggestedName?: string;
  /** Set when nothing could be read; the organizer falls back to the name. */
  error?: string;
};

function failure(filePath: string, error: string): InboxDocument {
  return { filePath, via: "none", excerpt: "", lineCount: 0, truncated: false, error };
}

export async function readInboxDocument(
  vaultPath: string,
  filePath: string,
  limit = 4000,
): Promise<InboxDocument> {
  const extension = path.extname(filePath).toLowerCase();

  if (IMAGE_EXTS.has(extension)) {
    const describer = imageDescriber();
    if (!describer.available()) {
      return failure(filePath, "no_vision_model_configured");
    }
    const absolutePath = safeVaultPath(vaultPath, filePath);
    if (!absolutePath) return failure(filePath, "unsafe_path");

    try {
      const draft = await describer.describe({ absolutePath, fileName: path.basename(filePath) });
      const excerpt = renderImageDescription(draft).slice(0, limit);
      return {
        filePath,
        via: "vision",
        excerpt,
        lineCount: excerpt === "" ? 0 : excerpt.split("\n").length,
        truncated: false,
        suggestedName: sanitizeSuggestedName(draft.suggestedName) ?? undefined,
      };
    } catch (error) {
      return failure(filePath, error instanceof Error ? error.message : String(error));
    }
  }

  try {
    const extracted = await extractDocumentText(vaultPath, filePath, limit);
    return {
      filePath,
      via: extracted.via,
      excerpt: extracted.content,
      lineCount: extracted.lineCount,
      truncated: extracted.truncated,
      units: extracted.units,
    };
  } catch (error) {
    // A damaged, encrypted or unsupported file must not abort the whole pass.
    return failure(filePath, error instanceof Error ? error.message : String(error));
  }
}
