import { Command } from "commander";
import { resolveVaultPath } from "../../config/projectConfig.js";
import { runMapWorkflow } from "../../workflows/mapWorkflow.js";

export function registerMapCommand(program: Command): void {
  program
    .command("map")
    .description("Generate a read-only knowledge map artifact under .agent/maps")
    .option("--vault <path>", "Vault path. Defaults to vault.path in apothecary.config.yaml")
    .option("--scope <subpath>", "Optional subdirectory scope")
    .action(async (options: { vault?: string; scope?: string }) => {
      const vaultPath = await resolveVaultPath(options.vault);
      const result = await runMapWorkflow({ vaultPath, scopePath: options.scope });
      console.log("Knowledge map generated:");
      console.log(`- ${result.markdownPath}`);
      console.log(`- ${result.jsonPath}`);
    });
}
