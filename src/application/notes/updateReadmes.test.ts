import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let vault: string;
let updateReadmesForMove: typeof import("./updateReadmes.js").updateReadmesForMove;

const abs = (rel: string) => path.join(vault, rel);
const read = (rel: string) => readFile(abs(rel), "utf8");
const exists = (rel: string) =>
  access(abs(rel)).then(
    () => true,
    () => false,
  );

beforeAll(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "apothecary-readme-test-"));
  vi.stubEnv("APOTHECARY_VAULT_PATH", vault);
  ({ updateReadmesForMove } = await import("./updateReadmes.js"));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(vault, { recursive: true, force: true });
});

describe("updateReadmesForMove", () => {
  it("removes the note from the source index and adds it to the destination", async () => {
    await mkdir(abs("src"), { recursive: true });
    await mkdir(abs("dst"), { recursive: true });
    await writeFile(
      abs("src/README.md"),
      "# Src\n\n## 笔记索引\n\n- [X Note](x.md) — 2026/7/1\n- [Keep](keep.md) — 2026/7/1\n",
      "utf8",
    );
    // The file is already at its destination (post-rename); the title comes from it.
    await writeFile(abs("dst/x.md"), "# X Note\n\nbody", "utf8");

    await updateReadmesForMove(vault, "src/x.md", "dst/x.md");

    const src = await read("src/README.md");
    expect(src).not.toContain("(x.md)");
    expect(src).toContain("(keep.md)");

    const dst = await read("dst/README.md");
    expect(dst).toContain("[X Note](x.md)");
  });

  it("scaffolds the destination README when the directory has none", async () => {
    await mkdir(abs("fresh"), { recursive: true });
    await writeFile(abs("fresh/note.md"), "# Fresh Note", "utf8");

    expect(await exists("fresh/README.md")).toBe(false);
    await updateReadmesForMove(vault, "inbox/note.md", "fresh/note.md");

    expect(await read("fresh/README.md")).toContain("[Fresh Note](note.md)");
  });

  it("handles a rename: old basename removed, new basename added", async () => {
    await mkdir(abs("ren"), { recursive: true });
    await writeFile(abs("ren/README.md"), "## 笔记索引\n\n- [Old](old.md) — 2026/7/1\n", "utf8");
    await writeFile(abs("ren/new.md"), "# New Title", "utf8");

    await updateReadmesForMove(vault, "ren/old.md", "ren/new.md");

    const readme = await read("ren/README.md");
    expect(readme).not.toContain("(old.md)");
    expect(readme).toContain("[New Title](new.md)");
  });

  it("does nothing to a missing source README", async () => {
    await mkdir(abs("nosrc"), { recursive: true });
    await writeFile(abs("nosrc/n.md"), "# N", "utf8");
    // No source README exists; should not throw, and should still index the destination.
    await updateReadmesForMove(vault, "ghostdir/n.md", "nosrc/n.md");
    expect(await read("nosrc/README.md")).toContain("[N](n.md)");
  });
});
