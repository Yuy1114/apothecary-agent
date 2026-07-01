import { Agent } from "@mastra/core/agent";
import readline from "node:readline";
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
  "You help Yuy manage their vault. Use tools to scan, read, search, review, and propose edits.",
  "",
  "DEEP REVIEW WORKFLOW (when user asks to review):",
  "1. Call scanVault to get file list",
  "2. For each interesting file, call readMarkdown to read full content",
  "3. Analyze and give specific suggestions quoting actual file content",
  "4. Use proposeEdit to create actionable proposals if user confirms",
  "",
  "Guidelines:",
  "- Be concise. Short answers preferred.",
  "- ALWAYS read files before making judgments.",
  "- Use proposeEdit for edits (never modify directly).",
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

  // Auto-init if config is missing
  try {
    await loadConfig(workspace);
  } catch {
    console.log("Workspace not initialized. Running init...");
    await runInitWorkflow({ vaultPath: resolvedVault });
  }

  const config = await loadConfig(workspace);
  const reviewer = createReviewerModel(config) as MastraReviewerModel;
  const ctx: ChatContext = { vaultPath: resolvedVault, agent: reviewer.rawAgent, maxSteps: 12 };

  console.log("╔══════════════════════════════════════════╗");
  console.log("║        apothecary-agent                 ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log("║  /init /index /status /review /map      ║");
  console.log("║  /edits /help  |  exit to quit          ║");
  console.log("╚══════════════════════════════════════════╝\n");

  while (true) {
    const input = await question("apothecary> ");

    if (!input) continue;

    if (input === "exit" || input === "quit") {
      console.log("Bye.");
      break;
    }

    // ── Slash commands ──
    if (input === "/help") {
      showHelp();
      continue;
    }
    if (input === "/init") {
      await runInitWorkflow({ vaultPath: ctx.vaultPath });
      console.log("Done.");
      continue;
    }
    if (input === "/index") {
      console.log("Indexing vault with embeddings...");
      const { indexed } = await indexVault();
      console.log(`Done: ${indexed} chunks.`);
      continue;
    }
    if (input === "/status") {
      await runStatusWorkflow({ vaultPath: ctx.vaultPath });
      continue;
    }
    if (input.startsWith("/review")) {
      const scope = input.slice(8).trim() || undefined;
      console.log(scope ? `Reviewing ${scope}...` : "Reviewing full vault...");
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
    if (input === "/edits") {
      const proposals = await listProposals();
      const pending = proposals.filter((p) => p.status === "proposed");
      if (pending.length === 0) console.log("No pending edits.");
      else {
        for (const p of pending) console.log(`  [${p.id}] ${p.title} → ${p.filePath}`);
        console.log("  /edits apply <id> to review.");
      }
      continue;
    }
    if (input.startsWith("/edits apply ")) {
      const id = input.slice(13).trim();
      const proposals = await listProposals();
      const proposal = proposals.find((p) => p.id === id);
      if (!proposal || proposal.status !== "proposed") {
        console.log(proposal ? `Already ${proposal.status}.` : "Not found.");
        continue;
      }
      if (await hitlConfirm(proposal)) {
        await applyProposal(proposal);
        console.log("Applied.");
      } else {
        console.log("Rejected.");
      }
      continue;
    }

    // ── Agent chat ──
    if (input.startsWith("/")) {
      console.log("Unknown command. Type /help for list.");
      continue;
    }

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

function showHelp() {
  console.log("  /init        Initialize .agent workspace");
  console.log("  /index       Rebuild RAG index (needs embedding key)");
  console.log("  /status      Show vault statistics");
  console.log("  /review [scope]  Run maintenance review");
  console.log("  /map [scope]     Generate knowledge map");
  console.log("  /edits        List pending edit proposals");
  console.log("  /edits apply <id>  Review and apply an edit");
  console.log("  /help         Show commands");
  console.log("  exit          Quit");
  console.log("  Anything else → chat with the agent");
}

function question(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
