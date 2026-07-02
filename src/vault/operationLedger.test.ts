import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  initOperationLedger,
  setOperationLedgerClient,
  recordOperation,
  listOperations,
} from "./operationLedger.js";

const dirs: string[] = [];
afterEach(async () => {
  setOperationLedgerClient(null);
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function freshLedger(): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "apothecary-oplog-test-"));
  dirs.push(dir);
  await initOperationLedger(`file:${path.join(dir, "operations.db")}`);
}

describe("operationLedger", () => {
  it("records and lists operations, newest first", async () => {
    await freshLedger();
    await recordOperation({ type: "edit", targetFiles: ["notes/a.md"], source: "applyEdit" });
    await recordOperation({ type: "move", targetFiles: ["inbox/x.md", "notes/x.md"], source: "moveVaultFile" });

    const ops = await listOperations();
    expect(ops).toHaveLength(2);
    expect(ops[0].type).toBe("move");
    expect(ops[0].targetFiles).toEqual(["inbox/x.md", "notes/x.md"]);
  });

  it("filters by file path and type", async () => {
    await freshLedger();
    await recordOperation({ type: "edit", targetFiles: ["notes/a.md"], source: "applyEdit" });
    await recordOperation({ type: "move", targetFiles: ["inbox/x.md", "notes/x.md"], source: "moveVaultFile" });

    expect(await listOperations({ filePath: "notes/a.md" })).toHaveLength(1);
    expect(await listOperations({ type: "move" })).toHaveLength(1);
    expect(await listOperations({ filePath: "notes/x.md" })).toHaveLength(1);
  });

  it("is a safe no-op before initialization", async () => {
    setOperationLedgerClient(null);
    await expect(
      recordOperation({ type: "edit", targetFiles: ["x.md"], source: "s" }),
    ).resolves.toBeUndefined();
    expect(await listOperations()).toEqual([]);
  });
});
