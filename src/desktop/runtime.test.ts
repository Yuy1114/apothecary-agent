import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The port registry is the one thing in the layering that no type check can
 * verify: a composition root that forgets `installPorts()` compiles fine and
 * throws the first time a use case touches the index. Nine application modules
 * resolve a port at call time, and every unit test installs a fake — so the
 * real wiring is otherwise never exercised.
 *
 * This drives the Electron root for real (minus the watcher) and asserts the
 * ports go from unusable to usable. installPorts.test.ts covers the function
 * itself, which the Studio root shares.
 */
let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "apothecary-runtime-"));
  vi.stubEnv("APOTHECARY_HOME", home);
  vi.stubEnv("APOTHECARY_VAULT_PATH", path.join(home, "vault"));
  vi.stubEnv("APOTHECARY_DESKTOP_WATCH", "0");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

describe("createDesktopRuntime", () => {
  it("installs every port the application layer resolves at runtime", async () => {
    const index = await import("../application/ports/searchIndex.js");
    const summarizer = await import("../application/ports/fileSummarizer.js");

    // Nothing installed yet: a use case would fail loudly, not silently no-op.
    expect(() => index.searchIndex()).toThrow(/not installed/i);
    expect(() => summarizer.fileSummarizer()).toThrow(/not installed/i);

    const { createDesktopRuntime } = await import("./runtime.js");
    createDesktopRuntime(home);

    expect(index.searchIndex().reindexFile).toBeTypeOf("function");
    expect(index.searchIndex().removeFromIndex).toBeTypeOf("function");
    expect(index.searchIndex().queryVault).toBeTypeOf("function");
    expect(summarizer.fileSummarizer()).toBeTypeOf("function");
  });
});
