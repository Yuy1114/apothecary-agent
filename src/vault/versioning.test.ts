import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commitFileDiff,
  commitSnapshot,
  ensureVaultRepo,
  fileAtCommit,
  vaultVersioningEnabled,
} from "./versioning.js";

const execFileAsync = promisify(execFile);
const dirs: string[] = [];

async function makeVault(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "apothecary-versioning-"));
  dirs.push(dir);
  return dir;
}

async function gitOut(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

// The vitest config disables vault git globally (tests importing mastra/index
// must never version the real vault); this suite tests the git layer itself.
beforeEach(() => {
  process.env.APOTHECARY_VAULT_GIT = "1";
});

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
  process.env.APOTHECARY_VAULT_GIT = "0";
});

describe("vault versioning", () => {
  it("initialises a repo with ignore rules and a baseline commit", async () => {
    const vault = await makeVault();
    await writeFile(path.join(vault, "note.md"), "# hello\n");
    await ensureVaultRepo(vault);

    const ignore = await readFile(path.join(vault, ".gitignore"), "utf8");
    expect(ignore).toContain(".DS_Store");
    expect(ignore).toContain(".obsidian/");
    expect(await gitOut(vault, ["log", "--format=%s"])).toBe("baseline: initial vault snapshot");
    expect(await gitOut(vault, ["status", "--porcelain"])).toBe("");
  });

  it("merges ignore rules without clobbering existing lines, and commits drift as catch-up", async () => {
    const vault = await makeVault();
    await writeFile(path.join(vault, ".gitignore"), "media/\n");
    await writeFile(path.join(vault, "a.md"), "one\n");
    await ensureVaultRepo(vault);
    // Offline drift after the baseline…
    await writeFile(path.join(vault, "a.md"), "one edited offline\n");
    await ensureVaultRepo(vault);

    const ignore = await readFile(path.join(vault, ".gitignore"), "utf8");
    expect(ignore).toContain("media/");
    expect(ignore).toContain(".DS_Store");
    const log = (await gitOut(vault, ["log", "--format=%s"])).split("\n");
    expect(log[0]).toBe("manual: offline edits (startup catch-up)");
  });

  it("is idempotent on a clean repo (no empty commits)", async () => {
    const vault = await makeVault();
    await writeFile(path.join(vault, "a.md"), "x\n");
    await ensureVaultRepo(vault);
    const head = await gitOut(vault, ["rev-parse", "HEAD"]);
    await ensureVaultRepo(vault);
    expect(await gitOut(vault, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("commitSnapshot returns a sha for changes and null when clean", async () => {
    const vault = await makeVault();
    await writeFile(path.join(vault, "a.md"), "x\n");
    await ensureVaultRepo(vault);

    expect(await commitSnapshot(vault, "agent: noop")).toBeNull();

    await writeFile(path.join(vault, "a.md"), "y\n");
    const sha = await commitSnapshot(vault, "agent: edit a.md");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await gitOut(vault, ["log", "-1", "--format=%s"])).toBe("agent: edit a.md");
  });

  it("scoped snapshots leave unrelated dirty files uncommitted", async () => {
    const vault = await makeVault();
    await writeFile(path.join(vault, "a.md"), "a\n");
    await writeFile(path.join(vault, "b.md"), "b\n");
    await ensureVaultRepo(vault);
    await writeFile(path.join(vault, "a.md"), "a2\n");
    await writeFile(path.join(vault, "b.md"), "b2\n");

    const sha = await commitSnapshot(vault, "agent: edit a only", ["a.md"]);
    expect(sha).not.toBeNull();
    const status = await gitOut(vault, ["status", "--porcelain"]);
    expect(status).toContain("b.md");
    expect(status).not.toContain("a.md");
  });

  it("captures moves (delete + add) through a scoped snapshot", async () => {
    const vault = await makeVault();
    await writeFile(path.join(vault, "a.md"), "content\n");
    await ensureVaultRepo(vault);
    await execFileAsync("git", ["mv", "a.md", "moved.md"], { cwd: vault });
    // Simulate our appliers: plain fs move, then snapshot from+to.
    await execFileAsync("git", ["reset"], { cwd: vault });

    const sha = await commitSnapshot(vault, "agent: move a.md -> moved.md", ["a.md", "moved.md"]);
    expect(sha).not.toBeNull();
    expect(await fileAtCommit(vault, sha!, "moved.md")).toBe("content\n");
    expect(await fileAtCommit(vault, sha!, "a.md")).toBeNull();
  });

  it("commitFileDiff returns before/after across a commit, null on the missing side", async () => {
    const vault = await makeVault();
    await writeFile(path.join(vault, "a.md"), "v1\n");
    await ensureVaultRepo(vault);
    await writeFile(path.join(vault, "a.md"), "v2\n");
    const edit = await commitSnapshot(vault, "agent: edit", ["a.md"]);
    await writeFile(path.join(vault, "new.md"), "fresh\n");
    const create = await commitSnapshot(vault, "manual: 1 external edit", ["new.md"]);

    expect(await commitFileDiff(vault, edit!, "a.md")).toEqual({ before: "v1\n", after: "v2\n" });
    expect(await commitFileDiff(vault, create!, "new.md")).toEqual({ before: null, after: "fresh\n" });
  });

  it("honours the APOTHECARY_VAULT_GIT=0 escape hatch flag", () => {
    delete process.env.APOTHECARY_VAULT_GIT;
    expect(vaultVersioningEnabled()).toBe(true);
    process.env.APOTHECARY_VAULT_GIT = "0";
    expect(vaultVersioningEnabled()).toBe(false);
  });
});
