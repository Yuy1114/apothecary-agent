import { Command } from "commander";
import { runInitWorkflow } from "../../workflows/initWorkflow.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Create the .agent workspace for a vault")
    .requiredOption("--vault <path>", "Vault path")
    .action(async (options: { vault: string }) => {
      const result = await runInitWorkflow({ vaultPath: options.vault });
      console.log(`Initialized apothecary-agent workspace: ${result.agentPath}`);
      if (result.created.length > 0) {
        console.log("Created:");
        for (const file of result.created) console.log(`- ${file}`);
      } else {
        console.log("Protocol files already existed.");
      }
    });
}
