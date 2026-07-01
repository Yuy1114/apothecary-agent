import { Command } from "commander";
import { formatStatus, runStatusWorkflow } from "../../workflows/statusWorkflow.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Scan a vault and print a read-only status summary")
    .requiredOption("--vault <path>", "Vault path")
    .option("--scope <subpath>", "Optional subdirectory scope")
    .action(async (options: { vault: string; scope?: string }) => {
      const result = await runStatusWorkflow({ vaultPath: options.vault, scopePath: options.scope });
      console.log(formatStatus(result));
    });
}
