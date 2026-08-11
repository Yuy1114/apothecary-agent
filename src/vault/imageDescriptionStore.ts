import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ImageKindSchema } from "../domain/imageDescription.js";
import { apothecaryHome } from "../config/apothecaryHome.js";

/**
 * What the agent has seen in each image, keyed by vault-relative path.
 *
 * Kept apart from `file-summaries.json` on purpose. That store is driven by the
 * markdown pipeline — the watcher, `syncSemanticsFromChanges` and the profile
 * writer all iterate it and would try to re-read an image as UTF-8 text. This
 * one is only ever written by the describe pass.
 *
 * `contentHash` is what makes the pass idempotent and resumable, which matters
 * because every entry here cost a paid vision call: re-running describes only
 * images that are new or have changed.
 */

const ImageDescriptionRecordSchema = z.object({
  path: z.string().min(1),
  contentHash: z.string().min(1),
  describedAt: z.string().min(1),
  kind: ImageKindSchema,
  description: z.string(),
  text: z.string(),
  suggestedName: z.string(),
});
export type ImageDescriptionRecord = z.infer<typeof ImageDescriptionRecordSchema>;

const ImageDescriptionsSchema = z.object({
  version: z.literal(1).default(1),
  descriptions: z.record(z.string(), ImageDescriptionRecordSchema).default({}),
});
export type ImageDescriptions = z.infer<typeof ImageDescriptionsSchema>;

const EMPTY: ImageDescriptions = { version: 1, descriptions: {} };

function storePath(home: string): string {
  return path.join(home, "semantic", "image-descriptions.json");
}

export async function loadImageDescriptions(
  home: string = apothecaryHome(),
): Promise<ImageDescriptions> {
  try {
    return ImageDescriptionsSchema.parse(JSON.parse(await fs.readFile(storePath(home), "utf8")));
  } catch {
    // Missing or corrupt reads as empty: the pass will simply describe again.
    return EMPTY;
  }
}

export async function saveImageDescriptions(
  descriptions: ImageDescriptions,
  home: string = apothecaryHome(),
): Promise<void> {
  const file = storePath(home);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(descriptions, null, 2)}\n`, "utf8");
}

/** Drop records for images no longer in the vault. Pure. */
export function pruneMissingImages(
  descriptions: ImageDescriptions,
  presentPaths: Set<string>,
): { pruned: ImageDescriptions; removed: string[] } {
  const kept: Record<string, ImageDescriptionRecord> = {};
  const removed: string[] = [];
  for (const [key, record] of Object.entries(descriptions.descriptions)) {
    if (presentPaths.has(key)) kept[key] = record;
    else removed.push(key);
  }
  return { pruned: { ...descriptions, descriptions: kept }, removed };
}
