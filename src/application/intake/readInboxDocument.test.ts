import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readInboxDocument } from "./readInboxDocument.js";
import { clearImageDescriber, setImageDescriber } from "../ports/imageDescriber.js";
import type { ImageDescriptionDraft } from "../../domain/imageDescription.js";

const dirs: string[] = [];
afterEach(async () => {
  clearImageDescriber();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function vault(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "read-doc-"));
  dirs.push(dir);
  return dir;
}

function installDescriber(draft: Partial<ImageDescriptionDraft> = {}) {
  const describe = vi.fn(async (): Promise<ImageDescriptionDraft> => ({
    kind: "receipt_or_form",
    description: "A printed utility bill showing an account number and amount due.",
    text: "电费账单\n户号 1234567\n应缴 128.50 元",
    suggestedName: "电费账单 2026-07",
    ...draft,
  }));
  setImageDescriber({ available: () => true, describe });
  return describe;
}

describe("readInboxDocument — documents", () => {
  it("reads text formats through the extractor", async () => {
    const root = await vault();
    await writeFile(path.join(root, "note.md"), "# 标题\n正文", "utf8");

    const result = await readInboxDocument(root, "note.md");

    expect(result.via).toBe("plain");
    expect(result.excerpt).toContain("正文");
  });

  it("reports a failure instead of throwing, so one bad file cannot abort the pass", async () => {
    const root = await vault();
    const result = await readInboxDocument(root, "missing.md");
    expect(result.error).toBe("file_not_found");
    expect(result.excerpt).toBe("");
  });
});

describe("readInboxDocument — images", () => {
  it("says so plainly when no vision model is configured", async () => {
    const root = await vault();
    await writeFile(path.join(root, "IMG_4821.jpeg"), "bytes");

    const result = await readInboxDocument(root, "IMG_4821.jpeg");

    // The organizer must be able to tell "nothing looked at this" apart from
    // "looked and found nothing" — it falls back to the filename in the first case.
    expect(result.error).toBe("no_vision_model_configured");
    expect(result.via).toBe("none");
  });

  it("returns what the model saw, plus a filename worth adopting", async () => {
    const root = await vault();
    await writeFile(path.join(root, "IMG_4821.jpeg"), "bytes");
    const describe = installDescriber();

    const result = await readInboxDocument(root, "IMG_4821.jpeg");

    expect(result.via).toBe("vision");
    expect(result.excerpt).toContain("receipt_or_form");
    expect(result.excerpt).toContain("电费账单");
    expect(result.suggestedName).toBe("电费账单 2026-07");
    expect(describe).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "IMG_4821.jpeg" }),
    );
  });

  it("drops a suggested name that would not be a safe filename", async () => {
    const root = await vault();
    await writeFile(path.join(root, "x.png"), "bytes");
    installDescriber({ suggestedName: "../../etc/passwd" });

    const result = await readInboxDocument(root, "x.png");

    expect(result.suggestedName).toBe("etc passwd");
  });

  it("surfaces a vision failure as an error rather than crashing the pass", async () => {
    const root = await vault();
    await writeFile(path.join(root, "x.png"), "bytes");
    setImageDescriber({
      available: () => true,
      describe: async () => {
        throw new Error("rate_limited");
      },
    });

    const result = await readInboxDocument(root, "x.png");

    expect(result.error).toBe("rate_limited");
  });

  it("refuses to read outside the vault", async () => {
    const root = await vault();
    installDescriber();
    const result = await readInboxDocument(root, "../../secret.png");
    expect(result.error).toBe("unsafe_path");
  });
});
