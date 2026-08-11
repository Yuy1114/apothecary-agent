import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describeVaultImages } from "./describeVaultImages.js";
import { clearImageDescriber, setImageDescriber } from "../ports/imageDescriber.js";
import { setSearchIndex, nullSearchIndex } from "../ports/searchIndex.js";
import { loadImageDescriptions } from "../../vault/imageDescriptionStore.js";
import type { ImageDescriptionDraft } from "../../domain/imageDescription.js";

const dirs: string[] = [];
afterEach(async () => {
  clearImageDescriber();
  setSearchIndex(nullSearchIndex);
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function scratch(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function vaultWith(files: Record<string, string>): Promise<string> {
  const vault = await scratch("describe-vault-");
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(path.join(vault, path.dirname(rel)), { recursive: true });
    await writeFile(path.join(vault, rel), body, "utf8");
  }
  return vault;
}

const draft = (over: Partial<ImageDescriptionDraft> = {}): ImageDescriptionDraft => ({
  kind: "screenshot_code",
  description: "A terminal showing a Redis TTL command.",
  text: "EXPIRE session:42 3600",
  suggestedName: "Redis 过期命令",
  ...over,
});

function installDescriber(impl?: () => Promise<ImageDescriptionDraft>) {
  const describe = vi.fn(impl ?? (async () => draft()));
  setImageDescriber({ available: () => true, describe });
  return describe;
}

/** Records what was written to the index, so retrieval can be asserted. */
function recordingIndex() {
  const indexed: { path: string; content: string }[] = [];
  const removed: string[] = [];
  setSearchIndex({
    ...nullSearchIndex,
    async indexText(relativePath, content) {
      indexed.push({ path: relativePath, content });
      return { added: 1 };
    },
    async removeFromIndex(relativePath) {
      removed.push(relativePath);
      return { removed: 1 };
    },
  });
  return { indexed, removed };
}

describe("describeVaultImages", () => {
  it("describes each image and indexes it under its own path", async () => {
    const vault = await vaultWith({
      "media/screenshots/Screenshot 2026-07-20 at 10.12.34.png": "png",
      "notes/redis.md": "# Redis",
    });
    const home = await scratch("describe-home-");
    const index = recordingIndex();
    installDescriber();

    const report = await describeVaultImages({ vaultPath: vault, home });

    expect(report).toMatchObject({ total: 1, described: 1, upToDate: 0 });
    // Markdown is not this pass's business — it is already indexed.
    expect(index.indexed).toHaveLength(1);
    expect(index.indexed[0].path).toBe("media/screenshots/Screenshot 2026-07-20 at 10.12.34.png");
    // The words that were *inside* the screenshot are what make it findable.
    expect(index.indexed[0].content).toContain("EXPIRE session:42 3600");
    expect(index.indexed[0].content).toContain("Redis 过期命令");
  });

  it("does not pay twice for an unchanged image", async () => {
    const vault = await vaultWith({ "media/a.png": "png" });
    const home = await scratch("describe-home-");
    const describer = installDescriber();

    await describeVaultImages({ vaultPath: vault, home });
    const second = await describeVaultImages({ vaultPath: vault, home });

    expect(describer).toHaveBeenCalledOnce();
    expect(second).toMatchObject({ described: 0, upToDate: 1 });
  });

  it("re-describes when the image content changed", async () => {
    const vault = await vaultWith({ "media/a.png": "png" });
    const home = await scratch("describe-home-");
    const describer = installDescriber();

    await describeVaultImages({ vaultPath: vault, home });
    await writeFile(path.join(vault, "media/a.png"), "different bytes", "utf8");
    await describeVaultImages({ vaultPath: vault, home });

    expect(describer).toHaveBeenCalledTimes(2);
  });

  it("re-describes everything under --force", async () => {
    const vault = await vaultWith({ "media/a.png": "png" });
    const home = await scratch("describe-home-");
    const describer = installDescriber();

    await describeVaultImages({ vaultPath: vault, home });
    const forced = await describeVaultImages({ vaultPath: vault, home, force: true });

    expect(describer).toHaveBeenCalledTimes(2);
    expect(forced.described).toBe(1);
  });

  it("stops at the limit and says there is more", async () => {
    const vault = await vaultWith({ "media/a.png": "1", "media/b.png": "2", "media/c.png": "3" });
    const home = await scratch("describe-home-");
    const describer = installDescriber();

    const report = await describeVaultImages({ vaultPath: vault, home, limit: 2 });

    expect(describer).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({ total: 3, described: 2, more: true });
  });

  it("resumes where it stopped, without repaying", async () => {
    const vault = await vaultWith({ "media/a.png": "1", "media/b.png": "2", "media/c.png": "3" });
    const home = await scratch("describe-home-");
    const describer = installDescriber();

    await describeVaultImages({ vaultPath: vault, home, limit: 2 });
    const rest = await describeVaultImages({ vaultPath: vault, home });

    expect(describer).toHaveBeenCalledTimes(3);
    expect(rest).toMatchObject({ described: 1, upToDate: 2, more: false });
  });

  it("keeps the descriptions it already paid for when one image fails", async () => {
    const vault = await vaultWith({ "media/a.png": "1", "media/b.png": "2" });
    const home = await scratch("describe-home-");
    let call = 0;
    installDescriber(async () => {
      call += 1;
      if (call === 1) throw new Error("rate_limited");
      return draft();
    });

    const report = await describeVaultImages({ vaultPath: vault, home });

    expect(report.described).toBe(1);
    expect(report.failed).toEqual([{ path: "media/a.png", reason: "rate_limited" }]);
    const stored = await loadImageDescriptions(home);
    expect(Object.keys(stored.descriptions)).toEqual(["media/b.png"]);
  });

  it("skips the archive — cold storage is not worth paying to read", async () => {
    const vault = await vaultWith({ "archive/old.png": "1", "media/live.png": "2" });
    const home = await scratch("describe-home-");
    installDescriber();

    const report = await describeVaultImages({ vaultPath: vault, home });

    expect(report.total).toBe(1);
    expect(Object.keys((await loadImageDescriptions(home)).descriptions)).toEqual(["media/live.png"]);
  });

  it("drops records and index chunks for images that are gone", async () => {
    const vault = await vaultWith({ "media/a.png": "1" });
    const home = await scratch("describe-home-");
    installDescriber();
    await describeVaultImages({ vaultPath: vault, home });

    await rm(path.join(vault, "media/a.png"));
    const index = recordingIndex();
    const report = await describeVaultImages({ vaultPath: vault, home });

    expect(report.pruned).toBe(1);
    expect(index.removed).toEqual(["media/a.png"]);
    expect(await loadImageDescriptions(home)).toMatchObject({ descriptions: {} });
  });

  it("refuses to run with no vision model rather than reporting a clean pass", async () => {
    const vault = await vaultWith({ "media/a.png": "1" });
    const home = await scratch("describe-home-");
    await expect(describeVaultImages({ vaultPath: vault, home })).rejects.toThrow(
      "no_vision_model_configured",
    );
  });
});
