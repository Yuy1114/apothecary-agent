#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerMapCommand } from "./commands/map.js";
import { registerReviewCommand } from "./commands/review.js";
import { registerStatusCommand } from "./commands/status.js";

const program = new Command();

program
  .name("apothecary-agent")
  .description("Read-only Vault Reviewer for local Markdown knowledge bases")
  .version("0.1.0");

registerInitCommand(program);
registerStatusCommand(program);
registerMapCommand(program);
registerReviewCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
