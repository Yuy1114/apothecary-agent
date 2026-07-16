import { describe, expect, it } from "vitest";
import type { LibSQLVector } from "@mastra/libsql";

/**
 * Complements desktop/runtime.test.ts, which proves the Electron root calls
 * this. The Studio root (mastra/index.ts) cannot be driven from a test — its
 * module body syncs the live vault — but it now calls the same function, so
 * covering installPorts covers the wiring of both roots. What remains uncovered
 * is a root forgetting the call entirely: one visible line, not three.
 */
describe("installPorts", () => {
  it("installs every registry-injected port in one call", async () => {
    const index = await import("../../application/ports/searchIndex.js");
    const summarizer = await import("../../application/ports/fileSummarizer.js");

    expect(() => index.searchIndex()).toThrow(/not installed/i);
    expect(() => summarizer.fileSummarizer()).toThrow(/not installed/i);

    const { installPorts } = await import("./installPorts.js");
    installPorts({} as LibSQLVector);

    expect(index.searchIndex().reindexFile).toBeTypeOf("function");
    expect(index.searchIndex().removeFromIndex).toBeTypeOf("function");
    expect(index.searchIndex().queryVault).toBeTypeOf("function");
    expect(summarizer.fileSummarizer()).toBeTypeOf("function");
    // Importing the adapter graph transforms most of src/ — under a parallel
    // full-suite run that alone can exceed the default 5s.
  }, 30_000);
});
