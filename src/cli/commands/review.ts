import { Command } from "commander";
import { resolveVaultPath } from "../../config/projectConfig.js";
import { reviewWorkflow } from "../../mastra/workflows/review.js";

export function registerReviewCommand(program: Command): void {
  program
    .command("review")
    .description("Generate a read-only maintenance review under .agent/reviews")
    .option("--vault <path>", "Vault path. Defaults to vault.path in apothecary.config.yaml")
    .option("--scope <subpath>", "Optional subdirectory scope")
    .action(async (options: { vault?: string; scope?: string }) => {
      const vaultPath = await resolveVaultPath(options.vault);
      const run = await reviewWorkflow.createRun();
      const result = await run.start({ inputData: { vaultPath, scopePath: options.scope } });
      if (result.status !== "success") { console.log("Review failed."); return; }
      console.log("Maintenance review generated:");
      console.log(`- ${result.result.markdownPath}`);
      console.log(`- ${result.result.jsonPath}`);
    });
}
