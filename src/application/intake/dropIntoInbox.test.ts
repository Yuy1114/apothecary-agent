import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { dropIntoInbox, suffixName } from "./dropIntoInbox.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function scratch(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const exists = (p: string) => stat(p).then(() => true).catch(() => false);

describe("suffixName", () => {
  it("inserts the counter before the extension", () => {
    expect(suffixName("notes.md", 2)).toBe("notes (2).md");
    expect(suffixName("Grokking Algorithms.pdf", 3)).toBe("Grokking Algorithms (3).pdf");
  });

  it("appends to a name with no extension, e.g. a folder", () => {
    expect(suffixName("books", 2)).toBe("books (2)");
  });
});

describe("dropIntoInbox", () => {
  it("moves a file in and removes it from the source", async () => {
    const vault = await scratch("drop-vault-");
    const downloads = await scratch("drop-src-");
    const source = path.join(downloads, "读书笔记.pdf");
    await writeFile(source, "pdf-bytes", "utf8");

    const result = await dropIntoInbox(vault, [source]);

    expect(result.filed).toBe(1);
    expect(result.outcomes[0]).toMatchObject({ status: "filed", target: "_inbox/读书笔记.pdf" });
    expect(await readFile(path.join(vault, "_inbox", "读书笔记.pdf"), "utf8")).toBe("pdf-bytes");
    // "移动" means the original is gone — this is the behaviour Yuy chose.
    expect(await exists(source)).toBe(false);
  });

  it("creates _inbox when the vault does not have one yet", async () => {
    const vault = await scratch("drop-vault-");
    const downloads = await scratch("drop-src-");
    await writeFile(path.join(downloads, "a.md"), "x", "utf8");

    await dropIntoInbox(vault, [path.join(downloads, "a.md")]);

    expect(await readdir(path.join(vault, "_inbox"))).toEqual(["a.md"]);
  });

  it("de-duplicates a colliding name instead of overwriting", async () => {
    const vault = await scratch("drop-vault-");
    const downloads = await scratch("drop-src-");
    await mkdir(path.join(vault, "_inbox"), { recursive: true });
    await writeFile(path.join(vault, "_inbox", "note.md"), "原有内容", "utf8");
    await writeFile(path.join(downloads, "note.md"), "新拖进来的", "utf8");

    const result = await dropIntoInbox(vault, [path.join(downloads, "note.md")]);

    expect(result.outcomes[0]).toMatchObject({
      status: "filed",
      target: "_inbox/note (2).md",
      renamed: true,
    });
    // The pre-existing note must survive untouched.
    expect(await readFile(path.join(vault, "_inbox", "note.md"), "utf8")).toBe("原有内容");
    expect(await readFile(path.join(vault, "_inbox", "note (2).md"), "utf8")).toBe("新拖进来的");
  });

  it("moves a whole folder", async () => {
    const vault = await scratch("drop-vault-");
    const downloads = await scratch("drop-src-");
    await mkdir(path.join(downloads, "books", "sub"), { recursive: true });
    await writeFile(path.join(downloads, "books", "sub", "a.md"), "x", "utf8");

    const result = await dropIntoInbox(vault, [path.join(downloads, "books")]);

    expect(result.outcomes[0]).toMatchObject({ status: "filed", target: "_inbox/books" });
    expect(await exists(path.join(vault, "_inbox", "books", "sub", "a.md"))).toBe(true);
  });

  it("refuses a file that already lives in the vault", async () => {
    const vault = await scratch("drop-vault-");
    await mkdir(path.join(vault, "notes"), { recursive: true });
    const inVault = path.join(vault, "notes", "redis.md");
    await writeFile(inVault, "x", "utf8");

    const result = await dropIntoInbox(vault, [inVault]);

    // Re-filing a vault note is a vault change: it belongs in a move proposal,
    // not in a drag that bypasses the ledger.
    expect(result.outcomes[0]).toMatchObject({ status: "rejected", reason: "already_in_vault" });
    expect(result.filed).toBe(0);
    expect(await exists(inVault)).toBe(true);
  });

  it("reports a vanished source without failing the rest of the batch", async () => {
    const vault = await scratch("drop-vault-");
    const downloads = await scratch("drop-src-");
    const good = path.join(downloads, "good.md");
    await writeFile(good, "x", "utf8");

    const result = await dropIntoInbox(vault, [path.join(downloads, "gone.md"), good]);

    expect(result.outcomes[0]).toMatchObject({ status: "rejected", reason: "not_found" });
    expect(result.outcomes[1]).toMatchObject({ status: "filed" });
    expect(result.filed).toBe(1);
  });

  it("files several drops in one go", async () => {
    const vault = await scratch("drop-vault-");
    const downloads = await scratch("drop-src-");
    for (const name of ["a.md", "b.pdf", "c.png"]) {
      await writeFile(path.join(downloads, name), "x", "utf8");
    }

    const result = await dropIntoInbox(
      vault,
      ["a.md", "b.pdf", "c.png"].map((n) => path.join(downloads, n)),
    );

    expect(result.filed).toBe(3);
    expect((await readdir(path.join(vault, "_inbox"))).sort()).toEqual(["a.md", "b.pdf", "c.png"]);
  });
});
