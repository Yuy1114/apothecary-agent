import { Command } from "commander";
import { resolveVaultPath } from "../../config/projectConfig.js";
import { formatStatus, runStatusWorkflow } from "../../application/status/statusWorkflow.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Scan a vault and print a read-only status summary")
    .option("--vault <path>", "Vault path. Defaults to vault.path in apothecary.config.yaml")
    .option("--scope <subpath>", "Optional subdirectory scope")
    .action(async (options: { vault?: string; scope?: string }) => {
      const vaultPath = await resolveVaultPath(options.vault);
      const result = await runStatusWorkflow({ vaultPath, scopePath: options.scope });
      console.log(formatStatus(result));
    });
}
