#!/usr/bin/env node
import { collectAgentStatus } from "../application/status/agentStatus.js";
import { HELP, parseArgs } from "./args.js";
import { renderStatusText } from "./renderStatus.js";
import { resolveVaultPath } from "./vaultLocator.js";

/**
 * `apo` — apothecary's headless entrance, and its third composition root
 * alongside Mastra Studio and Electron.
 *
 * It exists so another agent (Hermes) can ask this one what is waiting without
 * a GUI being open: until now every loop the agent runs required the desktop
 * app to be running, which is exactly why nothing ever reached the human.
 *
 * `status` deliberately touches no LLM, starts no watcher, and opens the change
 * queue read-only (see vault/changeQueueReader), so it is safe to run on a
 * schedule alongside a live desktop app.
 *
 * No `dotenv` here on purpose: the CLI can be invoked from any working
 * directory, and silently absorbing whatever `.env` happens to sit in that cwd
 * would be worse than having no config at all. Commands that need credentials
 * should read them deliberately.
 */

async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!args.command) {
    process.stderr.write(HELP);
    return 1;
  }

  switch (args.command) {
    case "status": {
      const vaultPath = await resolveVaultPath(args.vault);
      const status = await collectAgentStatus(vaultPath);
      process.stdout.write(
        args.json ? `${JSON.stringify(status, null, 2)}\n` : `${renderStatusText(status)}\n`,
      );
      return 0;
    }
    default:
      process.stderr.write(`未知命令: ${args.command}\n\n${HELP}`);
      return 1;
  }
}

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`apo: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
