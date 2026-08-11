import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { imageDescriptionJsonSpec, parseImageDescription } from "../../domain/imageDescription.js";
import type { ImageDescriber } from "../../application/ports/imageDescriber.js";
import { logger } from "../../observability/logger.js";

const run = promisify(execFile);

/**
 * Reads an inbox image with a vision model.
 *
 * **Deliberately not a Mastra Agent**, unlike every other transformer here.
 * `agent.generate()` drops `type: "image"` content parts on the way to an
 * OpenAI-compatible provider — the request arrives with a null where the image
 * should be, whatever the encoding (data URI, bare base64, Uint8Array, a plain
 * https URL) and whatever the ordering. The same model answers correctly through
 * the AI SDK directly, so this adapter calls it itself. If a later Mastra release
 * fixes the conversion, this can move back; until then, routing it through an
 * Agent silently breaks image reading.
 *
 * Configuration, not a hardcoded choice: `APOTHECARY_VISION_MODEL` names the
 * model, and the endpoint/key fall back to the embedding provider's, since one
 * OpenAI-compatible aggregator commonly serves both.
 */

/** Longest edge sent to the model. Enough to read UI text, far short of a photo. */
const MAX_EDGE_PX = 1400;
/** Refuse rather than spend an unbounded amount on one file. */
const MAX_BYTES = 20 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
};

export type VisionConfig = { apiKey?: string; baseUrl?: string; model?: string };

export function visionConfig(env: NodeJS.ProcessEnv = process.env): VisionConfig {
  return {
    // Falls back to the embedding credentials on purpose: one aggregator commonly
    // serves both, and making the user paste the same key twice invites the two
    // copies to drift. An explicit vision key still wins.
    apiKey:
      env.APOTHECARY_VISION_API_KEY ||
      env.APOTHECARY_EMBEDDING_API_KEY ||
      env.OPENAI_API_KEY ||
      undefined,
    baseUrl: env.APOTHECARY_VISION_BASE_URL || env.APOTHECARY_EMBEDDING_BASE_URL || undefined,
    model: env.APOTHECARY_VISION_MODEL || undefined,
  };
}

/** A model id is the minimum; a custom endpoint additionally needs its key. */
export function visionConfigured(config: VisionConfig = visionConfig()): boolean {
  if (!config.model) return false;
  return config.baseUrl ? Boolean(config.apiKey) : true;
}

const SYSTEM =
  "You look at ONE image from a personal knowledge vault's inbox and report what it is, so an archivist agent " +
  "can decide where to file it. Be concrete and faithful — never guess at content you cannot see. " +
  "Write `description` in ENGLISH (it is agent-internal understanding). Transcribe `text` VERBATIM in its " +
  "original language, including code, UI labels and handwriting; leave it empty when the image has no text. " +
  "`suggestedName` is a short, human-readable filename stem in the image's own language, with no extension and " +
  "no date prefix — leave it empty rather than inventing something generic like 'image' or 'screenshot'. " +
  "If the image shows a document, receipt, form or ID, say so plainly: those are archival originals and are " +
  "filed differently from notes.\n\n" +
  // The reply is parsed by hand rather than through `generateObject`: this
  // provider rejects `response_format: json_object` unless the prompt says
  // "json", and even then returns a shape the SDK's schema check refuses, while
  // answering a plain instruction perfectly. Asking directly is what works.
  "Reply with ONLY a JSON object, no prose and no markdown fence:\n" +
  imageDescriptionJsonSpec();

/**
 * Downscale before sending, best-effort.
 *
 * Vision models bill by image area, and a phone photo is ~12 megapixels of which
 * the model needs maybe a twentieth to tell a receipt from a whiteboard. `sips`
 * ships with macOS, so this costs no dependency; anywhere it is missing (or on
 * any failure) the original is sent and the only consequence is a larger bill.
 */
async function downscaled(absolutePath: string): Promise<{ path: string; cleanup?: () => Promise<void> }> {
  if (process.platform !== "darwin") return { path: absolutePath };
  const directory = await fs.mkdtemp(path.join(tmpdir(), "apothecary-vision-"));
  const target = path.join(directory, `scaled${path.extname(absolutePath) || ".png"}`);
  try {
    await run("sips", ["-Z", String(MAX_EDGE_PX), absolutePath, "--out", target], { timeout: 20_000 });
    return { path: target, cleanup: () => fs.rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    logger.warn("vision", `sips 缩放失败，改用原图: ${(error as Error).message}`);
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    return { path: absolutePath };
  }
}

function visionModel(config: VisionConfig) {
  if (!config.baseUrl) return config.model!;
  return createOpenAICompatible({
    name: "apothecary-vision",
    baseURL: config.baseUrl,
    apiKey: config.apiKey!,
  })(config.model!);
}

export const visionImageDescriber: ImageDescriber = {
  available: () => visionConfigured(),

  describe: async ({ absolutePath, fileName }) => {
    const config = visionConfig();
    if (!visionConfigured(config)) throw new Error("image_describer_not_configured");

    const { size } = await fs.stat(absolutePath);
    if (size > MAX_BYTES) throw new Error("image_too_large");

    const scaled = await downscaled(absolutePath);
    try {
      const bytes = new Uint8Array(await fs.readFile(scaled.path));
      const mediaType = MIME_BY_EXT[path.extname(absolutePath).toLowerCase()] ?? "image/png";

      // One retry. This endpoint intermittently returns a body the SDK cannot
      // parse — the same image succeeded on all three following attempts — and
      // one wasted call is cheaper than filing a document as an anonymous
      // attachment because of a hiccup.
      return await withRetry(() => readOnce(config, bytes, mediaType, fileName));
    } finally {
      await scaled.cleanup?.().catch(() => {});
    }
  },
};

async function withRetry<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (first) {
    logger.warn("vision", `读图失败，重试一次: ${(first as Error).message}`);
    await new Promise((resolve) => setTimeout(resolve, 800));
    return attempt();
  }
}

async function readOnce(
  config: VisionConfig,
  bytes: Uint8Array,
  mediaType: string,
  fileName: string,
): Promise<import("../../domain/imageDescription.js").ImageDescriptionDraft> {
  const { text } = await generateText({
    model: visionModel(config) as Parameters<typeof generateText>[0]["model"],
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            // The filename is context, not an answer: it is precisely the
            // uninformative ones (IMG_4821, hash names) that get here.
            text: `Original filename: ${fileName}\nReport what this image is, as JSON.`,
          },
          // `image` is deprecated in favour of a `file` part, but a file part
          // reaches this provider as an attachment it will not look at — the
          // deprecated shape is the one that actually works.
          { type: "image", image: bytes, mediaType },
        ],
      },
    ],
  });

  return parseImageDescription(text);
}
