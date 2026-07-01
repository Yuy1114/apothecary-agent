import { Command } from "commander";
import { resolveVaultPath } from "../../config/projectConfig.js";
import { runInitWorkflow } from "../../workflows/initWorkflow.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Create the .agent workspace for a vault")
    .option("--vault <path>", "Vault path. Defaults to vault.path in apothecary.config.yaml")
    .action(async (options: { vault?: string }) => {
      const vaultPath = await resolveVaultPath(options.vault);
      const result = await runInitWorkflow({ vaultPath });
      console.log(`Initialized apothecary-agent workspace: ${result.agentPath}`);
      if (result.created.length > 0) {
        console.log("Created:");
        for (const file of result.created) console.log(`- ${file}`);
      } else {
        console.log("Protocol files already existed.");
      }
    });
}
