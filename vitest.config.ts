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
    },
  },
});
