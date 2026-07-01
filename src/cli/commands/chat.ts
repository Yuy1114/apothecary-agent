import type { Command } from "commander";
import readline from "node:readline";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { ensureAgentWorkspace } from "../../workspace/agentWorkspace.js";
import { loadConfig } from "../../config/config.js";
import { createReviewerModel } from "../../reviewer/createReviewerModel.js";
import type { MastraReviewerModel } from "../../agent/mastraReviewerModel.js";

const CHAT_AGENT_INSTRUCTIONS = [
  "You are apothecary-agent, a personal knowledge maintenance assistant.",
  "You help Yuy manage their vault at /Users/yuy/apothecary-vault.",
  "",
  "You have these tools:",
  "- scanVault: scan the vault to see what files exist",
  "- readMarkdown: read a specific file's full content for deep analysis",
  "- writeReview: persist maintenance review findings",
  "- queryVault: search the vault for relevant content",
  "- proposeEdit: create an edit proposal for human review",
  "",
  "DEEP REVIEW WORKFLOW (when user asks to review a topic or directory):",
  "1. Call scanVault to get file list",
  "2. For each interesting file, call readMarkdown to read full content",
  "3. Analyze: are there stale notes? missing indexes? duplicate content?",
  "4. For each finding, give specific suggestions quoting actual file content",
  "5. If user confirms, use proposeEdit to create actionable proposals",
  "",
  "Guidelines:",
  "- Be concise. Short answers preferred.",
  "- For review tasks, ALWAYS read files before making judgments — never guess from titles alone.",
  "- When suggesting edits, use proposeEdit (never modify files directly).",
  "- When asked about vault contents, use queryVault or scanVault first.",
  "- Summarize findings in Chinese when the user writes in Chinese.",
  "- /review <scope> triggers a full deep review workflow.",
].join("\n");

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Start an interactive chat session with apothecary-agent")
    .option("--vault <path>", "Path to the vault")
    .action(async (options: { vault?: string }) => {
      const vaultPath = await resolveExistingDirectory(
        options.vault ?? process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault",
      );
      const workspace = await ensureAgentWorkspace(vaultPath);
      const config = await loadConfig(workspace);
      const reviewer = createReviewerModel(config) as MastraReviewerModel;
      const agent = reviewer.rawAgent;

      console.log("╔══════════════════════════════════════════╗");
      console.log("║      apothecary-agent chat              ║");
      console.log("╠══════════════════════════════════════════╣");
      console.log("║  /review <scope>  — deep review         ║");
      console.log("║  scan|search|edit                       ║");
      console.log("║  Type 'exit' to quit                    ║");
      console.log("╚══════════════════════════════════════════╝\n");

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "you> ",
      });

      // Enable deep review by default with increased maxSteps
      const maxSteps = 12;

      rl.prompt();

      for await (const line of rl) {
        const input = line.trim();
        if (!input) {
          rl.prompt();
          continue;
        }

        if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
          console.log("Bye.");
          break;
        }

        // /review shorthand triggers deep review
        const prompt = input.startsWith("/review ")
          ? `Deep review the following scope: ${input.slice(8)}. Follow the deep review workflow: scan first, then read files, analyze, and give specific suggestions.`
          : input;

        process.stdout.write("agent> ");

        try {
          const result = await agent.generate(prompt, {
            maxSteps,
            system: CHAT_AGENT_INSTRUCTIONS,
            memory: {
              resource: "yuy",
              thread: "chat-session",
            },
          });
          console.log(result.text);

          if (result.toolCalls?.length) {
            const steps = [...new Set(result.toolCalls.map((tc) => tc.payload?.toolName).filter(Boolean))];
            console.log(`\n[tools used: ${steps.join(", ")}]`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`Error: ${message}`);
        }

        console.log();
        rl.prompt();
      }

      rl.close();
    });
}
