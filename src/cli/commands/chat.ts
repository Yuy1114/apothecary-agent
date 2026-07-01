import { Agent } from "@mastra/core/agent";
import readline from "node:readline";
import { promises as fs } from "node:fs";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { ensureAgentWorkspace } from "../../workspace/agentWorkspace.js";
import { loadConfig } from "../../config/config.js";
import { createReviewerModel } from "../../reviewer/createReviewerModel.js";
import type { MastraReviewerModel } from "../../agent/mastraReviewerModel.js";
import { indexVault } from "../../rag/chromaStore.js";
import { listProposals, applyProposal, hitlConfirm } from "../hitl.js";
import { runReviewWorkflow } from "../../workflows/reviewWorkflow.js";
import { runMapWorkflow } from "../../workflows/mapWorkflow.js";
import { runStatusWorkflow } from "../../workflows/statusWorkflow.js";
import { runInitWorkflow } from "../../workflows/initWorkflow.js";

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
    console.log("Workspace not initialized. Running init...");
    await runInitWorkflow({ vaultPath: resolvedVault });
    console.log("Done. To analyze and reorganize your vault, type /organize\n");
  }

  const config = await loadConfig(workspace);
  const reviewer = createReviewerModel(config) as MastraReviewerModel;
  const ctx: ChatContext = { vaultPath: resolvedVault, agent: reviewer.rawAgent, maxSteps: 20 };

  console.log("╔══════════════════════════════════════════╗");
  console.log("║        apothecary-agent                 ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log("║  /organize  — reorganize entire vault   ║");
  console.log("║  /init /index /status /review /map      ║");
  console.log("║  /edits /help  |  exit to quit          ║");
  console.log("╚══════════════════════════════════════════╝\n");

  while (true) {
    const input = await question("apothecary> ");

    if (!input) continue;
    if (input === "exit" || input === "quit") { console.log("Bye."); break; }
    if (input === "/help") { showHelp(); continue; }
    if (input === "/init") { await runInitWorkflow({ vaultPath: ctx.vaultPath }); console.log("Done."); continue; }
    if (input === "/index") { const { indexed } = await indexVault(); console.log(`Done: ${indexed} chunks.`); continue; }
    if (input === "/status") { await runStatusWorkflow({ vaultPath: ctx.vaultPath }); continue; }
    if (input.startsWith("/review")) {
      const scope = input.slice(8).trim() || undefined;
      const { markdownPath } = await runReviewWorkflow({ vaultPath: ctx.vaultPath, scopePath: scope });
      console.log(`Report: ${markdownPath}`);
      continue;
    }
    if (input.startsWith("/map")) {
      const scope = input.slice(5).trim() || undefined;
      const { markdownPath } = await runMapWorkflow({ vaultPath: ctx.vaultPath, scopePath: scope });
      console.log(`Map: ${markdownPath}`);
      continue;
    }
    if (input === "/edits") { await handleEdits(); continue; }
    if (input.startsWith("/edits apply ")) { await handleEditApply(input.slice(13).trim()); continue; }
    if (input === "/organize") {
      console.log("Starting vault organization... (Agent will scan and analyze)\n");
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

function question(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}
