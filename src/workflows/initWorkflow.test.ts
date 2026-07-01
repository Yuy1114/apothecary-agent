import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runInitWorkflow } from "./initWorkflow.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("runInitWorkflow", () => {
  it("creates config, protocol artifacts, and init log under the agent workspace", async () => {
    const vaultPath = await createTempVault();

    const result = await runInitWorkflow({ vaultPath });

    expect(result.agentPath).toBe(path.join(vaultPath, ".agent"));
    expect(result.created).toEqual([
      ".agent/config.yaml",
      ".agent/protocol/kb_protocol.md",
      ".agent/protocol/kb_protocol.yaml",
      ".agent/structure.yaml",
    ]);
    await expect(readFile(path.join(vaultPath, ".agent", "config.yaml"), "utf8")).resolves.toContain("version: 1");
    await expect(readFile(path.join(vaultPath, ".agent", "logs", "init.log"), "utf8")).resolves.toContain(
      "initialized apothecary-agent workspace",
    );
  });

  it("does not overwrite existing config or protocol artifacts", async () => {
    const vaultPath = await createTempVault();
    await runInitWorkflow({ vaultPath });
    const configPath = path.join(vaultPath, ".agent", "config.yaml");

    await import("node:fs/promises").then(({ writeFile }) => writeFile(configPath, "custom: true\n", "utf8"));

    const result = await runInitWorkflow({ vaultPath });

    expect(result.created).toEqual([]);
    await expect(readFile(configPath, "utf8")).resolves.toBe("custom: true\n");
  });
});

async function createTempVault(): Promise<string> {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "apothecary-vault-test-"));
  tempDirs.push(vaultPath);
  return vaultPath;
}
