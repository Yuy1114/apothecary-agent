import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readVaultText } from "./read-vault-text.js";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))));

async function vault(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "apothecary-read-text-"));
  dirs.push(dir);
  return dir;
}

describe("readVaultText", () => {
  it("reads UTF-8 txt content for inbox classification", async () => {
    const root = await vault();
    await writeFile(path.join(root, "idea.txt"), "Redis 复盘\n持久化策略", "utf8");
    await expect(readVaultText(root, "idea.txt")).resolves.toEqual({
      filePath: "idea.txt",
      mediaType: "text",
      content: "Redis 复盘\n持久化策略",
      lineCount: 2,
    });
  });

  it("refuses path traversal and unsupported formats", async () => {
    const root = await vault();
    await expect(readVaultText(root, "../outside.txt")).rejects.toThrow("unsafe_path");
    await expect(readVaultText(root, "image.png")).rejects.toThrow("unsupported_text_type");
  });
});
