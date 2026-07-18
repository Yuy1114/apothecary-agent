import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  enqueueChange,
  initChangeLog,
  listRecentChanges,
  setChangeLogClient,
} from "../../vault/changeLog.js";
import {
  initOperationLedger,
  listOperations,
  recordOperation,
  setOperationLedgerClient,
  setOperationSnapshotHook,
} from "../../vault/operationLedger.js";
import {
  agentCommitMessage,
  installVaultVersioning,
  snapshotExternalChanges,
  snapshotPathsFor,
} from "./vaultSnapshots.js";

const execFileAsync = promisify(execFile);
const dirs: string[] = [];

async function makeDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function gitOut(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

// The vitest config disables vault git globally; this suite is the one place
// (besides versioning.test) that exercises it for real, against tmp vaults.
beforeEach(() => {
  process.env.APOTHECARY_VAULT_GIT = "1";
});

afterEach(async () => {
  process.env.APOTHECARY_VAULT_GIT = "0";
  setOperationSnapshotHook(null);
  setOperationLedgerClient(null);
  setChangeLogClient(null);
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
});

describe("agentCommitMessage", () => {
  it("formats relocating ops as from -> to with the rationale as body", () => {
    expect(
      agentCommitMessage({
        type: "move",
        targetFiles: ["_inbox/a.md", "notes/a.md"],
        rationale: "belongs in notes",
        source: "moveVaultFile",
        detail: "",
      }),
    ).toBe("agent: move _inbox/a.md -> notes/a.md\n\nbelongs in notes");
  });

  it("formats single-target ops and falls back to detail", () => {
    expect(
      agentCommitMessage({ type: "edit", targetFiles: ["notes/a.md"], rationale: "", source: "polish", detail: "polished format" }),
    ).toBe("agent: edit notes/a.md\n\npolished format");
  });
});

describe("snapshotPathsFor", () => {
  it("adds each target's directory README and dedupes", () => {
    expect(snapshotPathsFor(["_inbox/a.md", "notes/b.md", "notes/c.md"])).toEqual([
      "_inbox/a.md",
      "notes/b.md",
      "notes/c.md",
      "_inbox/README.md",
      "notes/README.md",
    ]);
  });
});

describe("vault versioning integration", () => {
  it("commits each recorded operation and stamps the sha on the ledger row", async () => {
    const vault = await makeDir("apothecary-snap-vault-");
    const home = await makeDir("apothecary-snap-home-");
    await writeFile(path.join(vault, "a.md"), "v1\n");
    await initOperationLedger(`file:${path.join(home, "operations.db")}`);
    expect(await installVaultVersioning(vault)).toBe(true);

    // Simulate an applied agent edit, then record it.
    await writeFile(path.join(vault, "a.md"), "v2\n");
    await recordOperation({ type: "edit", targetFiles: ["a.md"], source: "test", rationale: "tweak" });

    const [op] = await listOperations({ limit: 1 });
    expect(op.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(await gitOut(vault, ["log", "-1", "--format=%s"])).toBe("agent: edit a.md");
    expect(await gitOut(vault, ["show", `${op.commitSha}:a.md`])).toBe("v2");
  });

  it("snapshotExternalChanges commits the batch and stamps only rows in the window", async () => {
    const vault = await makeDir("apothecary-snap-vault-");
    const home = await makeDir("apothecary-snap-home-");
    await initChangeLog(`file:${path.join(home, "change-log.db")}`);
    await installVaultVersioning(vault);

    // An old, never-snapshotted row for the same path must stay untouched.
    await enqueueChange({ path: "b.md", changeType: "created", source: "watcher" });
    const cutoff = new Date(Date.now() + 5).toISOString();
    await new Promise((resolve) => setTimeout(resolve, 10));

    await writeFile(path.join(vault, "b.md"), "external\n");
    await enqueueChange({ path: "b.md", changeType: "modified", source: "watcher" });
    const sha = await snapshotExternalChanges(vault, ["b.md"], cutoff);

    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await gitOut(vault, ["log", "-1", "--format=%s"])).toBe("manual: external edit b.md");
    const rows = await listRecentChanges({ since: new Date(Date.now() - 60_000).toISOString() });
    const stamped = rows.filter((row) => row.commitSha === sha);
    // enqueueChange dedupes pending rows per path, so the refreshed row (inside
    // the window) carries the sha.
    expect(stamped).toHaveLength(1);
    expect(stamped[0].path).toBe("b.md");
  });

  it("does nothing when versioning is disabled", async () => {
    process.env.APOTHECARY_VAULT_GIT = "0";
    const vault = await makeDir("apothecary-snap-vault-");
    expect(await installVaultVersioning(vault)).toBe(false);
    expect(await snapshotExternalChanges(vault, ["x.md"], new Date().toISOString())).toBeNull();
  });
});
