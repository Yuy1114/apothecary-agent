import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "release/**", "node_modules/**"],
    env: {
      // Importing mastra/index (e.g. installPorts.test) runs its bootstrap,
      // whose vault path defaults to the real vault — vault git activity must
      // never leak out of a test run. Versioning tests re-enable it locally.
      APOTHECARY_VAULT_GIT: "0",
      // Same hazard one layer over: helpers like commitSelfWrite default their
      // home argument to apothecaryHome(), so a test that stubs only
      // APOTHECARY_VAULT_PATH writes its fixture paths into the real
      // ~/.apothecary — poisoning the sync baseline, which the next app start
      // then reports as phantom deletions. Per-run temp dir, never the real
      // home. Tests still stub their own APOTHECARY_HOME for isolation from
      // each other; this is only the floor under them.
      APOTHECARY_HOME: path.join(os.tmpdir(), `apothecary-vitest-home-${process.pid}`),
    },
  },
});
