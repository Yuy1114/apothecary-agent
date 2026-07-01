import type { Command } from "commander";
import { indexVault, queryVault } from "../../rag/chromaStore.js";

export function registerRagCommands(program: Command): void {
  program
    .command("index")
    .description("Build the RAG index from the vault markdown files")
    .option("--scope <path>", "Limit to a subdirectory")
    .action(async (options: { scope?: string }) => {
      const { indexed } = await indexVault(options.scope);
      console.log(`Indexed ${indexed} chunks from the vault.`);
    });

  program
    .command("ask")
    .description("Ask a question about your vault")
    .argument("<question...>", "The question to ask")
    .option("--top-k <n>", "Number of results", "5")
    .action(async (questionParts: string[], options: { topK: string }) => {
      const question = questionParts.join(" ");
      const topK = parseInt(options.topK, 10);
      const results = await queryVault(question, topK);

      if (results.length === 0) {
        console.log("No results found. Try running 'index' first.");
        return;
      }

      for (const result of results) {
        console.log(`\n--- ${result.source} ---`);
        console.log(result.content.slice(0, 500));
      }
    });
}
