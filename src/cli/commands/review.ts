import { Command } from "commander";
import { runReviewWorkflow } from "../../workflows/reviewWorkflow.js";

export function registerReviewCommand(program: Command): void {
  program
    .command("review")
    .description("Generate a read-only maintenance review under .agent/reviews")
    .requiredOption("--vault <path>", "Vault path")
    .option("--scope <subpath>", "Optional subdirectory scope")
    .action(async (options: { vault: string; scope?: string }) => {
      const result = await runReviewWorkflow({ vaultPath: options.vault, scopePath: options.scope });
      console.log("Maintenance review generated:");
      console.log(`- ${result.markdownPath}`);
      console.log(`- ${result.jsonPath}`);
    });
}
