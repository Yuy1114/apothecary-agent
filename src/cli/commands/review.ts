import { Command } from "commander";
import { resolveVaultPath } from "../../config/projectConfig.js";
import { runReviewWorkflow } from "../../workflows/reviewWorkflow.js";

export function registerReviewCommand(program: Command): void {
  program
    .command("review")
    .description("Generate a read-only maintenance review under .agent/reviews")
    .option("--vault <path>", "Vault path. Defaults to vault.path in apothecary.config.yaml")
    .option("--scope <subpath>", "Optional subdirectory scope")
    .action(async (options: { vault?: string; scope?: string }) => {
      const vaultPath = await resolveVaultPath(options.vault);
      const result = await runReviewWorkflow({ vaultPath, scopePath: options.scope });
      console.log("Maintenance review generated:");
      console.log(`- ${result.markdownPath}`);
      console.log(`- ${result.jsonPath}`);
    });
}
