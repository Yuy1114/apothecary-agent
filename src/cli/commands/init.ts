import { Command } from "commander";
import { resolveVaultPath } from "../../config/projectConfig.js";
import { initWorkflow } from "../../mastra/workflows/init.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Create the .agent workspace for a vault")
    .option("--vault <path>", "Vault path. Defaults to vault.path in apothecary.config.yaml")
    .action(async (options: { vault?: string }) => {
      const vaultPath = await resolveVaultPath(options.vault);
      const run = await initWorkflow.createRun();
      const result = await run.start({ inputData: { vaultPath } });
      if (result.status !== "success") { console.log("Init failed."); return; }
      const { agentPath, created } = result.result;
      console.log(`Initialized apothecary-agent workspace: ${agentPath}`);
      if (created.length > 0) {
        console.log("Created:");
        for (const file of created) console.log(`- ${file}`);
      } else {
        console.log("Protocol files already existed.");
      }
    });
}
