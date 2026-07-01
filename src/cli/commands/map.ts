import { Command } from "commander";
import { runMapWorkflow } from "../../workflows/mapWorkflow.js";

export function registerMapCommand(program: Command): void {
  program
    .command("map")
    .description("Generate a read-only knowledge map artifact under .agent/maps")
    .requiredOption("--vault <path>", "Vault path")
    .option("--scope <subpath>", "Optional subdirectory scope")
    .action(async (options: { vault: string; scope?: string }) => {
      const result = await runMapWorkflow({ vaultPath: options.vault, scopePath: options.scope });
      console.log("Knowledge map generated:");
      console.log(`- ${result.markdownPath}`);
      console.log(`- ${result.jsonPath}`);
    });
}
