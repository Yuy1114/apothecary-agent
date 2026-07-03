import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { scanVault } from "./scanner.js";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))));

describe("scanVault scope safety", () => {
  it("scans an in-vault scope and refuses traversal", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "apothecary-scan-"));
    dirs.push(vault);
    await mkdir(path.join(vault, "inbox"));
    await writeFile(path.join(vault, "inbox", "a.md"), "# A", "utf8");
    const scan = await scanVault({ vaultPath: vault, scopePath: "inbox" });
    expect(scan.files.map((file) => file.path)).toEqual(["inbox/a.md"]);
    await expect(scanVault({ vaultPath: vault, scopePath: "../" })).rejects.toThrow("unsafe_scope_path");
  });
});
