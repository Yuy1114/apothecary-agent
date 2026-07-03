import { describe, expect, it } from "vitest";
import path from "node:path";
import { safeVaultPath } from "./pathSafety.js";

const VAULT = "/vault";

describe("safeVaultPath", () => {
  it("resolves a normal vault-relative path", () => {
    expect(safeVaultPath(VAULT, "notes/a.md")).toBe(path.resolve(VAULT, "notes/a.md"));
  });

  it("allows a nested path", () => {
    expect(safeVaultPath(VAULT, "notes/db/redis.md")).toBe(path.resolve(VAULT, "notes/db/redis.md"));
  });

  it("rejects a parent-traversal escape", () => {
    expect(safeVaultPath(VAULT, "../evil.md")).toBeNull();
    expect(safeVaultPath(VAULT, "notes/../../evil.md")).toBeNull();
  });

  it("rejects an absolute path", () => {
    expect(safeVaultPath(VAULT, "/etc/passwd")).toBeNull();
  });

  it("rejects the empty path and the vault root itself", () => {
    expect(safeVaultPath(VAULT, "")).toBeNull();
    expect(safeVaultPath(VAULT, ".")).toBeNull();
  });

  it("allows a traversal that stays within the vault", () => {
    expect(safeVaultPath(VAULT, "notes/../notes/a.md")).toBe(path.resolve(VAULT, "notes/a.md"));
  });

  it("allows the .agent subtree (a vault-internal path)", () => {
    expect(safeVaultPath(VAULT, ".agent/views/x.md")).toBe(path.resolve(VAULT, ".agent/views/x.md"));
  });
});
