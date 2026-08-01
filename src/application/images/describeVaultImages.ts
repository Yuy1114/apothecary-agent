import path from "node:path";
import { scanVault } from "../../vault/scanner.js";
import { hashFile } from "../../vault/hash.js";
import { isArchivedPath } from "../../vault/archive.js";
import {
  loadImageDescriptions,
  pruneMissingImages,
  saveImageDescriptions,
  type ImageDescriptions,
} from "../../vault/imageDescriptionStore.js";
import { imageSearchDocument } from "../../domain/imageDescription.js";
import { imageDescriber } from "../ports/imageDescriber.js";
import { searchIndex } from "../ports/searchIndex.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";
import { nowIso } from "../../utils/time.js";
import { logger } from "../../observability/logger.js";

/**
 * Make the vault's images findable.
 *
 * 快速归位 answers *where* an image goes, and it answers it from the filename
 * alone — correctly, because a screenshot belongs in `media/screenshots/`
 * whatever it depicts. But that leaves the picture itself unread: a folder of
 * `Screenshot 2026-07-20 at 10.12.34.png` is unsearchable, and the vector index
 * only ever ingested Markdown, so no image was reachable by search at all.
 *
 * This pass closes that gap without touching placement. Each image is read once
 * by the vision model; the description and transcription are stored and indexed
 * against the image's own path, so asking for "那张讲 Redis 过期策略的截图"
 * matches words that were *inside* the screenshot and the hit points at the file.
 *
 * Nothing here writes to the vault — descriptions are derived data under the
 * agent's own home, so no proposal is involved. Renaming files, which is a real
 * vault change, is a separate concern and stays behind the proposal gate.
 *
 * Every call costs money, so the pass is idempotent (content-hash keyed),
 * resumable (progress is saved as it goes, not at the end) and bounded (`limit`).
 */

export type DescribeImagesReport = {
  /** Images found in the vault. */
  total: number;
  /** Described on this run. */
  described: number;
  /** Skipped because the stored description still matches the file's hash. */
  upToDate: number;
  /** Failed reads, with their reason. */
  failed: { path: string; reason: string }[];
  /** Records dropped for images that no longer exist. */
  pruned: number;
  /** True when `limit` stopped the run before everything was covered. */
  more: boolean;
};

export type DescribeImagesOptions = {
  vaultPath: string;
  home?: string;
  /** Max images to describe in this run. Omit for all of them. */
  limit?: number;
  /** Re-describe even when the hash is unchanged. */
  force?: boolean;
};

export async function describeVaultImages(
  options: DescribeImagesOptions,
): Promise<DescribeImagesReport> {
  const { vaultPath, home = apothecaryHome(), limit, force = false } = options;

  const describer = imageDescriber();
  if (!describer.available()) throw new Error("no_vision_model_configured");

  const scan = await scanVault({ vaultPath });
  const images = scan.files
    // Archived images are cold storage; paying to describe them is not worth it.
    .filter((file) => file.mediaType === "image" && !isArchivedPath(file.path))
    .sort((a, b) => a.path.localeCompare(b.path));

  let store: ImageDescriptions = await loadImageDescriptions(home);
  const present = new Set(images.map((file) => file.path));
  const { pruned, removed } = pruneMissingImages(store, present);
  store = pruned;
  for (const gone of removed) {
    await searchIndex().removeFromIndex(gone).catch(() => undefined);
  }

  const report: DescribeImagesReport = {
    total: images.length,
    described: 0,
    upToDate: 0,
    failed: [],
    pruned: removed.length,
    more: false,
  };

  for (const image of images) {
    const existing = store.descriptions[image.path];
    const contentHash = await hashFile(path.join(vaultPath, image.path));

    if (!force && existing?.contentHash === contentHash) {
      report.upToDate += 1;
      continue;
    }
    if (limit !== undefined && report.described >= limit) {
      report.more = true;
      break;
    }

    try {
      const draft = await describer.describe({
        absolutePath: path.join(vaultPath, image.path),
        fileName: path.basename(image.path),
      });

      store = {
        ...store,
        descriptions: {
          ...store.descriptions,
          [image.path]: { path: image.path, contentHash, describedAt: nowIso(), ...draft },
        },
      };
      await searchIndex().indexText(image.path, imageSearchDocument({ path: image.path, draft }));
      // Saved per image, not at the end: a run interrupted after twenty paid
      // calls must not throw those twenty away.
      await saveImageDescriptions(store, home);
      report.described += 1;
      logger.info("vision", `已描述 ${image.path}（${report.described}/${images.length}）`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      report.failed.push({ path: image.path, reason });
      logger.warn("vision", `描述失败 ${image.path}: ${reason}`);
    }
  }

  if (removed.length > 0 && report.described === 0) await saveImageDescriptions(store, home);
  return report;
}
