import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// The vector index is out of scope here; stub it so the core can run without a
// configured embedding store. recordOperation is a safe no-op before ledger init.
const removeFromIndex = vi.fn(async () => ({ removed: 0 }));
vi.mock("./rag.js", () => ({ removeFromIndex }));

let vault: string;
let archiveVaultFileCore: typeof import("./archive-vault-file-core.js").archiveVaultFileCore;

const abs = (rel: string) => path.join(vault, rel);
const exists = async (rel: string) =>
  access(abs(rel)).then(
    () => true,
    () => false,
  );

beforeAll(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "apothecary-archive-test-"));
  vi.stubEnv("APOTHECARY_VAULT_PATH", vault);
  ({ archiveVaultFileCore } = await import("./archive-vault-file-core.js"));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(vault, { recursive: true, force: true });
});

describe("archiveVaultFileCore", () => {
  it("moves a note under archive/ non-destructively and drops it from the index", async () => {
    await mkdir(abs("notes"), { recursive: true });
    await writeFile(abs("notes/a.md"), "# A", "utf8");

    const result = await archiveVaultFileCore("notes/a.md", { reason: "low value" });

    expect(result).toMatchObject({ archived: true, to: "archive/notes/a.md", reindexed: true });
    expect(await exists("notes/a.md")).toBe(false);
    expect(await exists("archive/notes/a.md")).toBe(true);
    // Content is preserved — archiving is a move, not a rewrite.
    expect(await readFile(abs("archive/notes/a.md"), "utf8")).toBe("# A");
    expect(removeFromIndex).toHaveBeenCalledWith("notes/a.md");
  });

  it("never overwrites: a second archive of the same path gets a counter suffix", async () => {
    await mkdir(abs("notes"), { recursive: true });
    await writeFile(abs("notes/dup.md"), "v1", "utf8");
    const first = await archiveVaultFileCore("notes/dup.md");
    expect(first.to).toBe("archive/notes/dup.md");

    await writeFile(abs("notes/dup.md"), "v2", "utf8");
    const second = await archiveVaultFileCore("notes/dup.md");

    expect(second.to).toBe("archive/notes/dup (1).md");
    // Both copies survive with their distinct content.
    expect(await readFile(abs("archive/notes/dup.md"), "utf8")).toBe("v1");
    expect(await readFile(abs("archive/notes/dup (1).md"), "utf8")).toBe("v2");
  });

  it("reports missing_source without touching anything", async () => {
    const result = await archiveVaultFileCore("notes/nope.md");
    expect(result).toMatchObject({ archived: false, reason: "missing_source" });
  });

  it("refuses to archive an already-archived path", async () => {
    const result = await archiveVaultFileCore("archive/notes/a.md");
    expect(result).toMatchObject({ archived: false, reason: "already_archived" });
  });

  it("archives a non-markdown file without touching the index", async () => {
    await writeFile(abs("data.txt"), "x", "utf8");
    const result = await archiveVaultFileCore("data.txt");
    expect(result).toMatchObject({ archived: true, to: "archive/data.txt", reindexed: false });
  });
});
