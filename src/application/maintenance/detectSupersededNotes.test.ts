import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectSupersededNotes } from "./detectSupersededNotes.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function freshVault(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "apothecary-superseded-test-"));
  dirs.push(dir);
  await mkdir(path.join(dir, "notes"), { recursive: true });
  return dir;
}

describe("detectSupersededNotes", () => {
  it("finds active notes with a superseded_by link, ignoring current and archived ones", async () => {
    const vault = await freshVault();
    await writeFile(path.join(vault, "notes/current.md"), "# Current\n\nno frontmatter", "utf8");
    await writeFile(
      path.join(vault, "notes/old.md"),
      "---\ntitle: Old\nsuperseded_by: notes/canonical.md\n---\nold body",
      "utf8",
    );
    // An already-archived superseded note must NOT be reported (archive is ignored).
    await mkdir(path.join(vault, "archive", "notes"), { recursive: true });
    await writeFile(
      path.join(vault, "archive/notes/older.md"),
      "---\nsuperseded_by: notes/canonical.md\n---\nx",
      "utf8",
    );

    const result = await detectSupersededNotes(vault);

    expect(result).toEqual([{ path: "notes/old.md", supersededBy: "notes/canonical.md" }]);
  });

  it("returns empty when nothing is superseded", async () => {
    const vault = await freshVault();
    await writeFile(path.join(vault, "notes/a.md"), "# A", "utf8");
    expect(await detectSupersededNotes(vault)).toEqual([]);
  });
});
