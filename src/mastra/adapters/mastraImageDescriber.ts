import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { imageDescriberAgent, visionConfigured } from "../agents/transformers/image-describer.js";
import { ImageDescriptionDraftSchema } from "../../domain/imageDescription.js";
import type { ImageDescriber } from "../../application/ports/imageDescriber.js";
import { logger } from "../../observability/logger.js";

const run = promisify(execFile);

/** Longest edge sent to the model. Enough to read UI text, far short of a photo. */
const MAX_EDGE_PX = 1400;
/** Refuse rather than spend an unbounded amount on one file. */
const MAX_BYTES = 20 * 1024 * 1024;

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
  const target = path.join(
    await fs.mkdtemp(path.join(tmpdir(), "apothecary-vision-")),
    `scaled${path.extname(absolutePath) || ".png"}`,
  );
  try {
    await run("sips", ["-Z", String(MAX_EDGE_PX), absolutePath, "--out", target], { timeout: 20_000 });
    return {
      path: target,
      cleanup: () => fs.rm(path.dirname(target), { recursive: true, force: true }),
    };
  } catch (error) {
    logger.debug?.("vision", `sips 缩放失败，改用原图: ${(error as Error).message}`);
    await fs.rm(path.dirname(target), { recursive: true, force: true }).catch(() => {});
    return { path: absolutePath };
  }
}

export const mastraImageDescriber: ImageDescriber = {
  available: () => visionConfigured(),

  describe: async ({ absolutePath, fileName }) => {
    const agent = imageDescriberAgent();
    if (!agent) throw new Error("image_describer_not_configured");

    const { size } = await fs.stat(absolutePath);
    if (size > MAX_BYTES) throw new Error("image_too_large");

    const scaled = await downscaled(absolutePath);
    try {
      const bytes = await fs.readFile(scaled.path);
      const result = await agent.generate(
        [
          {
            role: "user",
            content: [
              {
                type: "text",
                // The filename is context, not an answer: it is precisely the
                // uninformative ones (IMG_4821, hash names) that get here.
                text:
                  `Original filename: ${fileName}\n` +
                  "Report what this image is. Output ONLY the structured fields.",
              },
              { type: "image", image: new Uint8Array(bytes) },
            ],
          },
        ],
        {
          maxSteps: 1,
          toolChoice: "none",
          structuredOutput: { schema: ImageDescriptionDraftSchema, jsonPromptInjection: "system" },
        },
      );

      const draft = result.object;
      if (!draft) {
        throw new Error(`vision model returned no structured output (finishReason=${result.finishReason})`);
      }
      // Structured output is typed as the schema's *input*, so optional fields
      // arrive undefined; parsing applies the defaults and validates the rest.
      return ImageDescriptionDraftSchema.parse(draft);
    } finally {
      await scaled.cleanup?.().catch(() => {});
    }
  },
};
