import { Command } from "commander";
import { resolveVaultPath } from "../../config/projectConfig.js";
import { mapWorkflow } from "../../mastra/workflows/map.js";

export function registerMapCommand(program: Command): void {
  program
    .command("map")
    .description("Generate a read-only knowledge map artifact under .agent/maps")
    .option("--vault <path>", "Vault path. Defaults to vault.path in apothecary.config.yaml")
    .option("--scope <subpath>", "Optional subdirectory scope")
    .action(async (options: { vault?: string; scope?: string }) => {
      const vaultPath = await resolveVaultPath(options.vault);
      const run = await mapWorkflow.createRun();
      const result = await run.start({ inputData: { vaultPath, scopePath: options.scope } });
      if (result.status !== "success") { console.log("Map failed."); return; }
      console.log("Knowledge map generated:");
      console.log(`- ${result.result.markdownPath}`);
      console.log(`- ${result.result.jsonPath}`);
    });
}
