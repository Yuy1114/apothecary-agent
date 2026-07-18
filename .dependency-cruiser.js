/**
 * Layer boundaries for apothecary-agent.
 *
 *   domain      pure types + rules; depends on nothing but itself
 *   utils safety observability protocol   leaf helpers
 *   config      local paths + config files
 *   vault artifacts reports              infrastructure (disk, yaml, markdown)
 *   application use cases + ports/ (interfaces infra must implement)
 *   mastra      framework adapters, agents, tools, workflows
 *   desktop     Electron shell / composition root
 *
 * The one rule that matters: dependencies point down. Every violation this file
 * forbids was a real edge in the codebase before the layering refactor.
 */
export default {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "A dependency cycle means the two modules are really one module.",
      from: {},
      to: { circular: true },
    },
    {
      name: "domain-is-pure",
      severity: "error",
      comment:
        "domain/ holds the rules of the knowledge base. It may not know that disk, " +
        "Mastra or Electron exist. Put shared data shapes in domain and let the " +
        "upper layers import them.",
      from: { path: "^src/domain" },
      to: {
        path: "^src/(application|mastra|vault|desktop|reports|artifacts|config|safety|observability|protocol)",
      },
    },
    {
      name: "application-not-framework",
      severity: "error",
      comment:
        "Use cases must not import Mastra, its agents, its tools, or the Electron " +
        "shell. If a use case needs an LLM or the vector index, declare a port in " +
        "application/ports/ and let mastra/adapters/ implement it.",
      from: { path: "^src/application", pathNot: "\\.test\\.ts$" },
      to: { path: "^src/(mastra|desktop)" },
    },
    {
      name: "no-mastra-package-in-application",
      severity: "error",
      comment: "Same rule, one level down: no @mastra/* or ai-sdk inside application/.",
      from: { path: "^src/application" },
      to: { dependencyTypes: ["npm"], path: "^(@mastra/|@ai-sdk/|ai$)" },
    },
    {
      name: "infra-not-upward",
      severity: "error",
      comment:
        "vault/, artifacts/ and reports/ are storage and rendering. They may not " +
        "reach up into use cases, the framework or the shell.",
      from: { path: "^src/(vault|artifacts|reports)", pathNot: "\\.test\\.ts$" },
      to: { path: "^src/(application|mastra|desktop)" },
    },
    {
      name: "foundation-not-infra",
      severity: "error",
      comment:
        "config/, utils/, safety/ and observability/ sit under everything. If one " +
        "of them needs a constant from an upper layer, the constant is in the " +
        "wrong place — sink it into domain/.",
      from: { path: "^src/(config|utils|safety|observability)", pathNot: "\\.test\\.ts$" },
      to: { path: "^src/(vault|application|mastra|desktop|reports)" },
    },
    {
      name: "ports-declare-nothing-concrete",
      severity: "error",
      comment:
        "application/ports/ is the interface layer. It may only speak domain types.",
      from: { path: "^src/application/ports" },
      to: { path: "^src/(?!domain|application/ports)" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^src/desktop/ui" },
    // Must stay true. `import type` is erased at build time, so with this off
    // dependency-cruiser sees the post-compile graph and a type-only boundary
    // violation is invisible — which is exactly what domain/reorgPlan.ts did to
    // mastra/tools/vault-structure.ts before this refactor. A leaked type is a
    // leaked dependency: it still couples the layers at compile time.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
