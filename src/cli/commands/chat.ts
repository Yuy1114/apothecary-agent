import { Agent } from "@mastra/core/agent";
import readline from "node:readline";
import { promises as fs } from "node:fs";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { ensureAgentWorkspace } from "../../workspace/agentWorkspace.js";
import { vaultReviewer } from "../../mastra/agents/vault-reviewer.js";
import { indexVault } from "../../rag/vectorStore.js";
import { listProposals, applyProposal, hitlConfirm } from "../hitl.js";
import { initWorkflow } from "../../mastra/workflows/init.js";
import { reviewWorkflow } from "../../mastra/workflows/review.js";
import { mapWorkflow } from "../../mastra/workflows/map.js";
import { runStatusWorkflow } from "../../workflows/statusWorkflow.js";

const CHAT_AGENT_INSTRUCTIONS = [
  "You are apothecary-agent, a personal knowledge maintenance assistant.",
  "You help Yuy manage their vault. Use tools to scan, read, search, review, ingest, and propose edits.",
  "",
  "VAULT ORGANIZE WORKFLOW (when user says /organize):",
  "1. Call scanVault to get ALL files in the vault",
  "2. Call readMarkdown on representative files from each directory to understand their content",
  "3. Analyze: what topics naturally emerge? Which files belong together?",
  "4. Present your proposed new directory structure — clear, hierarchical, based on actual content",
  "5. List every file move: 'old/path.md → new/path.md' with a brief reason",
  "6. Ask the user to confirm before executing",
  "7. If confirmed, use proposeEdit for each move (create new file, mark old for deletion)",
  "8. For each new directory, create a README.md summarizing its contents",
  "",
  "KEY PRINCIPLES for organizing:",
  "- Structure should emerge from content, not from a template",
  "- Group by actual topic (Java, Redis, React, DSA, projects, career, etc.)",
  "- Use clear directory names (notes/programming/Java/, career/, projects/do-together/)",
  "- Don't be afraid to suggest significant reorganization if content warrants it",
  "- Always explain WHY you're suggesting each move",
  "",
  "CONTENT INGESTION WORKFLOW:",
  "When user shares new knowledge: use ingestVault. It auto-classifies and updates README.",
  "",
  "DEEP REVIEW WORKFLOW:",
  "1. scanVault → 2. readMarkdown key files → 3. analyze → 4. specific suggestions → 5. proposeEdit",
  "",
  "Guidelines:",
  "- Be concise. Short answers preferred.",
  "- ALWAYS read files before making judgments.",
  "- Use proposeEdit for edits, ingestVault for new content.",
  "- Summarize findings in Chinese when the user writes in Chinese.",
].join("\n");

type ChatContext = {
  vaultPath: string;
  agent: Agent;
  maxSteps: number;
};

export async function createChatSession(vaultPath?: string): Promise<void> {
  if (vaultPath) process.env.APOTHECARY_VAULT_PATH = vaultPath;

  const resolvedVault = await resolveExistingDirectory(
    process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault",
  );
  const workspace = await ensureAgentWorkspace(resolvedVault);

  // Check if config exists — if not, auto-init
  let configExists = false;
  try {
    await fs.access(workspace.configPath);
    configExists = true;
  } catch {
    // config missing
  }

  if (!configExists) {
    console.log("Workspace not initialized. Running init...\n");
    await (await initWorkflow.createRun()).start({ inputData: { vaultPath: resolvedVault } });
    console.log("Init done. Now analyzing your vault...\n");
  }

  const ctx: ChatContext = { vaultPath: resolvedVault, agent: vaultReviewer, maxSteps: 20 };

  console.log("╔══════════════════════════════════════════╗");
  console.log("║        apothecary-agent                 ║");
  console.log("╠══════════════════════════════════════════╣");

  // Auto-organize on first launch
  if (!configExists) {
    console.log("║  Analyzing vault structure...           ║");
    console.log("╚══════════════════════════════════════════╝\n");
    await autoOrganize(ctx);
  } else {
    console.log("║  /organize /index /review /map /help    ║");
    console.log("║  Type anything to chat, exit to quit    ║");
    console.log("╚══════════════════════════════════════════╝\n");
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const q = (prompt: string) => new Promise<string>((resolve) => rl.question(prompt, (a: string) => resolve(a.trim())));

  while (true) {
    const input = await q("apothecary> ");

    if (!input) continue;
    if (input === "exit" || input === "quit") { console.log("Bye."); rl.close(); break; }
    if (input === "/help") { showHelp(); continue; }
    if (input === "/init") { const run = await initWorkflow.createRun(); const result = await run.start({ inputData: { vaultPath: ctx.vaultPath } }); console.log(`Created: ${result.status === "success" ? result.result.created.join(", ") : "failed"}`); continue; }
    if (input === "/index") { const { indexed } = await indexVault(); console.log(`Done: ${indexed} chunks.`); continue; }
    if (input === "/status") { await runStatusWorkflow({ vaultPath: ctx.vaultPath }); continue; }
    if (input.startsWith("/review")) {
      const scope = input.slice(8).trim() || undefined;
      const run = await reviewWorkflow.createRun();
      const result = await run.start({ inputData: { vaultPath: ctx.vaultPath, scopePath: scope } });
      if (result.status === "success") console.log(`Report: ${result.result.markdownPath}`);
      else console.log("Review failed.");
      continue;
    }
    if (input.startsWith("/map")) {
      const scope = input.slice(5).trim() || undefined;
      const run = await mapWorkflow.createRun();
      const result = await run.start({ inputData: { vaultPath: ctx.vaultPath, scopePath: scope } });
      if (result.status === "success") console.log(`Map: ${result.result.markdownPath}`);
      else console.log("Map failed.");
      continue;
    }
    if (input === "/edits") { await handleEdits(); continue; }
    if (input.startsWith("/edits apply ")) { await handleEditApply(input.slice(13).trim()); continue; }
    if (input === "/organize") {
      await autoOrganize(ctx);
      continue;
    }
    if (input.startsWith("/")) { console.log("Unknown command. Type /help."); continue; }

    // Agent chat
    process.stdout.write("agent> ");
    try {
      const result = await ctx.agent.generate(input, {
        maxSteps: ctx.maxSteps,
        system: CHAT_AGENT_INSTRUCTIONS,
        memory: { resource: "yuy", thread: "chat-session" },
      });
      console.log(result.text);
      const tools = [...new Set(result.toolCalls?.map((tc: { payload?: { toolName?: string } }) => tc.payload?.toolName).filter(Boolean) ?? [])];
      if (tools.length) console.log(`[tools: ${tools.join(", ")}]`);
    } catch (error) {
      console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log();
  }
}

async function handleEdits() {
  const proposals = await listProposals();
  const pending = proposals.filter((p) => p.status === "proposed");
  if (pending.length === 0) console.log("No pending edits.");
  else {
    for (const p of pending) console.log(`  [${p.id}] ${p.title} → ${p.filePath}`);
    console.log("  /edits apply <id> to review.");
  }
}

async function handleEditApply(id: string) {
  const proposals = await listProposals();
  const p = proposals.find((x) => x.id === id);
  if (!p || p.status !== "proposed") { console.log(p ? `Already ${p.status}.` : "Not found."); return; }
  if (await hitlConfirm(p)) { await applyProposal(p); console.log("Applied."); }
  else console.log("Rejected.");
}

async function autoOrganize(ctx: ChatContext) {
  console.log("Scanning your vault to understand its structure...\n");

  try {
    const result = await ctx.agent.generate(
      "Organize this vault. Follow the VAULT ORGANIZE WORKFLOW: " +
        "1. scanVault to see all files. 2. readMarkdown on key files to understand content. " +
        "3. Propose a new directory structure based on actual content. " +
        "4. List every suggested move with reasons. " +
        "Start now — scan the vault and propose a structure.",
      {
        maxSteps: 30,
        system: CHAT_AGENT_INSTRUCTIONS,
        memory: { resource: "yuy", thread: "organize-session" },
      },
    );

    console.log(result.text);
    const tools = [...new Set(result.toolCalls?.map((tc: { payload?: { toolName?: string } }) => tc.payload?.toolName).filter(Boolean) ?? [])];
    if (tools.length) console.log(`\n[tools: ${tools.join(", ")}]`);

    console.log('\nType "yes" to execute the plan, or anything else to skip.');
    const confirm = await ask("execute? [y/N] ");

    if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
      console.log("\nExecuting...\n");
      const execResult = await ctx.agent.generate(
        "Execute the reorganization plan you just proposed. " +
          "Use moveVaultFile for each file you need to move. " +
          "For each new directory, use proposeEdit to create a README.md listing its contents. " +
          "After all moves, use proposeEdit to update structure.yaml with the final layout.",
        {
          maxSteps: 30,
          system: CHAT_AGENT_INSTRUCTIONS,
          memory: { resource: "yuy", thread: "organize-session" },
        },
      );
      console.log(execResult.text);
      console.log("\nReorganization complete. Restarting chat...\n");
    } else {
      console.log("Skipped. You can run /organize later.\n");
    }
  } catch (error) {
    console.log(`Organize interrupted: ${error instanceof Error ? error.message : String(error)}`);
    console.log("You can run /organize later.\n");
  }
}

function showHelp() {
  console.log("  /organize     Reorganize vault structure based on content analysis");
  console.log("  /init         Initialize workspace");
  console.log("  /index        Rebuild RAG index");
  console.log("  /status       Show vault statistics");
  console.log("  /review [scope]  Run maintenance review");
  console.log("  /map [scope]     Generate knowledge map");
  console.log("  /edits         List pending edit proposals");
  console.log("  /edits apply <id>  Review and apply an edit");
  console.log("  /help          Show commands");
  console.log("  exit           Quit");
}

// One-off readline for autoOrganize confirmation
function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}
