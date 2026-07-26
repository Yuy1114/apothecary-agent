import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { apothecaryHome } from "./apothecaryHome.js";

/**
 * Tripwire for the vitest.config.ts safety net. Helpers such as
 * commitSelfWrite default their `home` argument to apothecaryHome(), so
 * without a run-wide APOTHECARY_HOME any test that forgets to stub it writes
 * fixture paths into the developer's real ~/.apothecary. That poisoned the
 * sync baseline, and every following app start reported the fixture files as
 * deleted notes. Fail loudly here rather than out there.
 */
describe("apothecaryHome under test", () => {
  it("never resolves to the real home directory", () => {
    const real = path.join(os.homedir(), ".apothecary");
    expect(apothecaryHome()).not.toBe(real);
  });

  it("is pinned to a temp directory by the vitest config", () => {
    expect(process.env.APOTHECARY_HOME).toBeDefined();
    expect(apothecaryHome().startsWith(path.resolve(os.tmpdir()))).toBe(true);
  });
});
