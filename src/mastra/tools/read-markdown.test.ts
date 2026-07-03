import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readMarkdown } from "./read-markdown.js";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))));

describe("readMarkdown", () => {
  it("reads markdown inside the vault and rejects traversal/non-markdown", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "apothecary-read-md-"));
    dirs.push(vault);
    await writeFile(path.join(vault, "a.md"), "# A\n\nbody", "utf8");
    expect((await readMarkdown(vault, "a.md")).title).toBe("A");
    await expect(readMarkdown(vault, "../outside.md")).rejects.toThrow("unsafe_path");
    await expect(readMarkdown(vault, "a.txt")).rejects.toThrow("unsupported_markdown_type");
  });
});
