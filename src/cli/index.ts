#!/usr/bin/env node
import { HELP, parseArgs, type ParsedArgs } from "./args.js";
import { loadProjectEnv } from "./env.js";
import { resolveVaultPath } from "./vaultLocator.js";
import {
  ankiDueCommand,
  askCommand,
  dayCommand,
  findingsCommand,
  journalCommand,
  proposalsListCommand,
  proposalsShowCommand,
  relatedCommand,
  statusCommand,
  type CommandResult,
} from "./commands/read.js";
import { scheduleCommand } from "./commands/schedule.js";
import {
  auditReadmeCommand,
  captureCommand,
  intakePlanCommand,
  polishCommand,
  describeImagesCommand,
  briefCommand,
} from "./commands/propose.js";

/**
 * `apo` — apothecary's headless entrance, and its third composition root
 * alongside Mastra Studio and Electron.
 *
 * It exists so another agent (Hermes) can drive this one without a GUI: until
 * now every loop the agent runs required the desktop app to be open, which is
 * exactly why nothing ever reached the human.
 *
 * Two invariants hold across every command:
 *
 * - **Nothing here can change the vault** — except `apo schedule`, the single
 *   deliberate exception: a generated schedule is derived output (like activity
 *   digests), so it skips the proposal gate by design. Everything else either
 *   reads, or produces a proposal awaiting approval. Approving is a human
 *   action and deliberately has no command, so an unattended caller cannot talk
 *   itself into applying.
 * - **stdout carries only the result.** Diagnostics go to stderr, so `--json`
 *   output stays parseable even when a use case logs progress.
 */

function requireArg(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

async function dispatch(args: ParsedArgs, vaultPath: string): Promise<CommandResult> {
  const [command, second, third] = args.positionals;

  switch (command) {
    case "status":
      return statusCommand(vaultPath);

    case "proposals": {
      const sub = second ?? "list";
      if (sub === "list") return proposalsListCommand(args.limit);
      if (sub === "show") {
        return proposalsShowCommand(requireArg(third, "proposals show 需要一个提案 id"));
      }
      throw new Error(`未知的 proposals 子命令: ${sub}（可选 list|show）`);
    }

    case "ask":
      return askCommand(vaultPath, requireArg(second, 'ask 需要一个问题，例如 apo ask "…"'), args.topK);

    case "related":
      return relatedCommand(
        vaultPath,
        requireArg(second, 'related 需要一个话题，例如 apo related "排课"'),
        args.topK,
      );

    case "day":
      return dayCommand(vaultPath, requireArg(second, "day 需要一个日期，例如 apo day 2026-08-11"));

    case "schedule":
      return scheduleCommand(vaultPath, second);

    case "findings":
      return findingsCommand(vaultPath, args.limit ?? 20);

    case "journal": {
      const which = second ?? "today";
      if (which !== "today" && which !== "yesterday") {
        throw new Error(`未知的 journal 子命令: ${which}（可选 today|yesterday）`);
      }
      return journalCommand(vaultPath, which);
    }

    case "anki": {
      const sub = second ?? "due";
      if (sub !== "due") throw new Error(`未知的 anki 子命令: ${sub}（目前只有 due）`);
      return ankiDueCommand();
    }

    case "intake": {
      if (second !== "plan") throw new Error("用法: apo intake plan");
      return intakePlanCommand();
    }

    case "capture":
      return captureCommand(requireArg(second, 'capture 需要内容，例如 apo capture "…"'), {
        topic: args.topic,
        source: "cli",
      });

    case "brief":
      return briefCommand(vaultPath);

    case "describe": {
      if (second !== "images") throw new Error("用法: apo describe images [--limit N] [--force]");
      return describeImagesCommand(vaultPath, { limit: args.limit, force: args.force });
    }

    case "audit": {
      if (second !== "readme") throw new Error("用法: apo audit readme");
      return auditReadmeCommand(vaultPath);
    }

    case "polish":
      return polishCommand(
        vaultPath,
        requireArg(second, "polish 需要一个药柜内的文件路径"),
        args.modes,
      );

    default:
      throw new Error(`未知命令: ${command}`);
  }
}

async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.positionals.length === 0) {
    process.stderr.write(HELP);
    return 1;
  }

  // stdout is the result channel. Anything a use case or Mastra prints along the
  // way is diagnostics, and would otherwise corrupt `--json` output.
  console.log = (...values: unknown[]) => {
    console.error(...values);
  };

  await loadProjectEnv();
  const vaultPath = await resolveVaultPath(args.vault);
  // Must happen before any dynamic import of mastra/: those modules read this
  // into a module constant at import time (see runtime.ts).
  process.env.APOTHECARY_VAULT_PATH = vaultPath;

  const result = await dispatch(args, vaultPath);
  process.stdout.write(
    args.json ? `${JSON.stringify(result.json, null, 2)}\n` : `${result.text}\n`,
  );
  return result.exitCode ?? 0;
}

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`apo: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
