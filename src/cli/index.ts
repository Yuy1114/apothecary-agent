#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerMapCommand } from "./commands/map.js";
import { registerReviewCommand } from "./commands/review.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerRagCommands } from "./commands/rag.js";
import { registerEditCommands } from "./commands/edit.js";
import { createChatSession } from "./commands/chat.js";
import { startApothecaryServer } from "../server/app.js";

const program = new Command();

program
  .name("apothecary-agent")
  .description("Personal knowledge maintenance agent for local Markdown vaults")
  .version("0.1.0");

registerInitCommand(program);
registerStatusCommand(program);
registerMapCommand(program);
registerReviewCommand(program);
registerRagCommands(program);
registerEditCommands(program);

program
  .command("ui")
  .description("Start the local web UI for vault chat, editing, activity, and jobs")
  .option("--port <port>", "Port to bind", "8787")
  .option("--vault <path>", "Vault path")
  .action(async (options: { port: string; vault?: string }) => {
    await startApothecaryServer({ port: Number(options.port), vaultPath: options.vault });
  });

// Default: start interactive chat session
program.action(async () => {
  await createChatSession();
});

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
