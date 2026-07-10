import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setSearchIndex, nullSearchIndex } from "../../application/ports/searchIndex.js";
import { mkdtemp, rm, writeFile, mkdir, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Vector index is out of scope; stub it. recordOperation is a no-op before init.
const reindexFile = vi.fn(async () => ({ added: 0 }));
const removeFromIndex = vi.fn(async () => ({ removed: 0 }));
setSearchIndex({ ...nullSearchIndex, reindexFile, removeFromIndex });

let vault: string;
let mergeNotesCore: typeof import("./merge-notes-core.js").mergeNotesCore;

const abs = (rel: string) => path.join(vault, rel);
const read = (rel: string) => readFile(abs(rel), "utf8");
const exists = async (rel: string) =>
  access(abs(rel)).then(
    () => true,
    () => false,
  );

beforeAll(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "apothecary-merge-test-"));
  vi.stubEnv("APOTHECARY_VAULT_PATH", vault);
  ({ mergeNotesCore } = await import("./merge-notes-core.js"));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(vault, { recursive: true, force: true });
});

describe("mergeNotesCore", () => {
  it("writes merged content into the canonical note and archives the source", async () => {
    await mkdir(abs("notes"), { recursive: true });
    await writeFile(abs("notes/redis.md"), "# Redis\n\nkeep this", "utf8");
    await writeFile(abs("notes/redis-copy.md"), "# Redis copy\n\ndupe", "utf8");

    const result = await mergeNotesCore({
      sourcePath: "notes/redis-copy.md",
      canonicalPath: "notes/redis.md",
      canonicalContent: "# Redis\n\nkeep this + merged detail",
      reason: "harmful duplicate",
    });

    expect(result).toMatchObject({
      merged: true,
      archivedTo: "archive/notes/redis-copy.md",
    });
    // Canonical updated in place.
    expect(await read("notes/redis.md")).toBe("# Redis\n\nkeep this + merged detail");
    // Source retired non-destructively — gone from active path, present in archive.
    expect(await exists("notes/redis-copy.md")).toBe(false);
    expect(await read("archive/notes/redis-copy.md")).toBe("# Redis copy\n\ndupe");
    // Index kept consistent.
    expect(reindexFile).toHaveBeenCalledWith("notes/redis.md");
    expect(removeFromIndex).toHaveBeenCalledWith("notes/redis-copy.md");
  });

  it("can merge into a brand-new canonical note", async () => {
    await mkdir(abs("notes"), { recursive: true });
    await writeFile(abs("notes/old.md"), "old content", "utf8");

    const result = await mergeNotesCore({
      sourcePath: "notes/old.md",
      canonicalPath: "canonical/topic.md",
      canonicalContent: "# Canonical\n\nsynthesized",
    });

    expect(result.merged).toBe(true);
    expect(await read("canonical/topic.md")).toBe("# Canonical\n\nsynthesized");
    expect(await exists("notes/old.md")).toBe(false);
    expect(await exists("archive/notes/old.md")).toBe(true);
  });

  it("refuses to merge a note into itself (would archive the canonical)", async () => {
    await mkdir(abs("notes"), { recursive: true });
    await writeFile(abs("notes/self.md"), "content", "utf8");

    const result = await mergeNotesCore({
      sourcePath: "notes/self.md",
      canonicalPath: "notes/self.md",
      canonicalContent: "new",
    });

    expect(result).toMatchObject({ merged: false, reason: "same_file" });
    // Untouched.
    expect(await read("notes/self.md")).toBe("content");
  });

  it("rejects empty canonical content without touching files", async () => {
    await mkdir(abs("notes"), { recursive: true });
    await writeFile(abs("notes/a.md"), "a", "utf8");

    const result = await mergeNotesCore({
      sourcePath: "notes/a.md",
      canonicalPath: "notes/b.md",
      canonicalContent: "   ",
    });

    expect(result).toMatchObject({ merged: false, reason: "empty_content" });
    expect(await exists("notes/a.md")).toBe(true);
    expect(await exists("notes/b.md")).toBe(false);
  });

  it("reports missing_source and does not write the canonical", async () => {
    const result = await mergeNotesCore({
      sourcePath: "notes/ghost.md",
      canonicalPath: "notes/target.md",
      canonicalContent: "content",
    });

    expect(result).toMatchObject({ merged: false, reason: "missing_source" });
    expect(await exists("notes/target.md")).toBe(false);
  });

  it("refuses an already-archived source or canonical", async () => {
    const archivedSource = await mergeNotesCore({
      sourcePath: "archive/notes/x.md",
      canonicalPath: "notes/y.md",
      canonicalContent: "c",
    });
    expect(archivedSource).toMatchObject({ merged: false, reason: "source_archived" });

    const archivedCanonical = await mergeNotesCore({
      sourcePath: "notes/y.md",
      canonicalPath: "archive/notes/z.md",
      canonicalContent: "c",
    });
    expect(archivedCanonical).toMatchObject({ merged: false, reason: "canonical_archived" });
  });
});
