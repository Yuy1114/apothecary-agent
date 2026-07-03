import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadProfileRefreshState,
  markProfileDirty,
  clearProfileDirty,
} from "./profileState.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function freshVault(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "apothecary-profilestate-test-"));
  dirs.push(dir);
  return dir;
}

describe("profile refresh state", () => {
  it("defaults to not-dirty when no state file exists", async () => {
    expect(await loadProfileRefreshState(await freshVault())).toEqual({ dirty: false });
  });

  it("marks dirty then clears on refresh", async () => {
    const vault = await freshVault();

    await markProfileDirty(vault);
    const dirty = await loadProfileRefreshState(vault);
    expect(dirty.dirty).toBe(true);
    expect(dirty.lastDirtyAt).toBeDefined();

    await clearProfileDirty(vault);
    const clean = await loadProfileRefreshState(vault);
    expect(clean.dirty).toBe(false);
    expect(clean.lastRefreshAt).toBeDefined();
  });
});
