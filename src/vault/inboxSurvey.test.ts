import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { surveyInbox } from "./inboxSurvey.js";
import { InboxSurveySchema } from "../domain/inboxSurvey.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function freshVault(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "apothecary-inbox-survey-"));
  dirs.push(dir);
  await mkdir(path.join(dir, "_inbox"), { recursive: true });
  return dir;
}

const write = (vault: string, rel: string, body = "x") =>
  writeFile(path.join(vault, "_inbox", rel), body, "utf8");

describe("surveyInbox", () => {
  it("lists top-level files with kind, folds directories, and excludes junk", async () => {
    const vault = await freshVault();
    await write(vault, "notes__Java__Spring.md");
    await write(vault, "Grokking Algorithms.pdf");
    await write(vault, "Screenshot 2026-07-03.png");
    await write(vault, ".DS_Store");
    await write(vault, "archive__notes__.DS_Store");
    // A real directory with nested files (should be folded, not expanded).
    await mkdir(path.join(vault, "_inbox", "books", "sub"), { recursive: true });
    await write(vault, "books/a.epub");
    await write(vault, "books/b.pdf");
    await write(vault, "books/sub/c.pdf");
    await writeFile(path.join(vault, "_inbox", "books", ".DS_Store"), "x", "utf8");
    // A package dir (opaque — must not be descended into).
    await mkdir(path.join(vault, "_inbox", "Photos Library.photoslibrary", "originals"), { recursive: true });
    await write(vault, "Photos Library.photoslibrary/originals/IMG_0001.heic");

    const survey = await surveyInbox(vault);
    expect(() => InboxSurveySchema.parse(survey)).not.toThrow();

    // Junk counted + sampled, not in entries.
    expect(survey.junk).toBe(2);
    expect(survey.junkSample).toContain(".DS_Store");
    expect(survey.entries.some((e) => e.kind === "junk")).toBe(false);

    const byPath = new Map(survey.entries.map((e) => [e.path, e]));
    expect(byPath.get("_inbox/notes__Java__Spring.md")?.kind).toBe("markdown");
    expect(byPath.get("_inbox/Grokking Algorithms.pdf")?.kind).toBe("pdf");
    expect(byPath.get("_inbox/Screenshot 2026-07-03.png")?.kind).toBe("image");

    // Directory folded: counts the 3 real files, skips the nested .DS_Store.
    const books = byPath.get("_inbox/books");
    expect(books?.kind).toBe("directory");
    expect(books?.fileCount).toBe(3);
    expect(books?.topExtensions).toContainEqual({ ext: ".pdf", count: 2 });

    // Package: opaque, no recursion, no fileCount.
    const pkg = byPath.get("_inbox/Photos Library.photoslibrary");
    expect(pkg?.kind).toBe("package");
    expect(pkg?.fileCount).toBeUndefined();

    // total = all top-level entries incl junk (5 files + books + package + .DS_Store... top-level only)
    // top-level: 3 files + 2 junk + books + package = 7
    expect(survey.total).toBe(7);
    expect(survey.entries.length).toBe(5);
  });

  it("returns an empty survey when _inbox is empty", async () => {
    const vault = await freshVault();
    const survey = await surveyInbox(vault);
    expect(survey).toMatchObject({ root: "_inbox", total: 0, junk: 0, entries: [] });
  });
});
