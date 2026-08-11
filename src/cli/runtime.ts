/**
 * The CLI's composition root for anything that needs Mastra.
 *
 * Two rules make this different from the other two roots:
 *
 * 1. **Import order is load-bearing.** `mastra/tools/*` and the sync watcher read
 *    `APOTHECARY_VAULT_PATH` into a module constant at import time. A static
 *    import would therefore freeze the *default* vault before the CLI has
 *    resolved which vault the app is actually pointed at — silently operating on
 *    the wrong one. Every Mastra import below is dynamic, and callers must set
 *    the env var first (index.ts does, right after resolving the vault).
 *
 * 2. **stdout belongs to the result.** Mastra and the intake runner log progress
 *    with `console.log`; a `--json` consumer must not receive that. index.ts
 *    redirects diagnostics to stderr for the whole process.
 *
 * The CLI also gets its own Mastra store, for the same reason the desktop app
 * has one separate from Studio's: these processes can be live at the same time.
 */

export type CliMastra = {
  mastra: import("@mastra/core/mastra").Mastra;
};

/**
 * Bind the registry ports (vector index + file summarizer) to their Mastra
 * implementations. Needed by anything that searches or indexes.
 */
export async function installCliPorts(): Promise<import("@mastra/libsql").LibSQLVector> {
  const [{ LibSQLVector }, { installPorts }, { apothecaryDb }] = await Promise.all([
    import("@mastra/libsql"),
    import("../mastra/adapters/installPorts.js"),
    import("../config/apothecaryDb.js"),
  ]);
  const vectorStore = new LibSQLVector({ id: "vault-chunks", url: apothecaryDb.vectors() });
  installPorts(vectorStore);
  return vectorStore;
}

/**
 * A minimal Mastra host: the organizer agent only, no watcher, no observability
 * file. Enough to drive an intake pass headlessly.
 */
export async function createCliMastra(): Promise<CliMastra> {
  const vectorStore = await installCliPorts();
  const [{ Mastra }, { LibSQLStore }, { organizer }, { apothecaryDb }] = await Promise.all([
    import("@mastra/core/mastra"),
    import("@mastra/libsql"),
    import("../mastra/agents/organizer.js"),
    import("../config/apothecaryDb.js"),
  ]);

  const mastra = new Mastra({
    agents: { organizer },
    storage: new LibSQLStore({ id: "apothecary-cli-storage", url: apothecaryDb.cliStore() }),
    vectors: { vaultChunks: vectorStore },
  });

  return { mastra };
}
