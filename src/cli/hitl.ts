import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

type EditProposal = {
  id: string;
  filePath: string;
  title: string;
  description: string;
  currentContent: string;
  suggestedContent: string;
  status: "proposed" | "applied" | "rejected";
  createdAt: string;
};

export async function listProposals(): Promise<EditProposal[]> {
  const editsDir = path.join(VAULT_PATH, ".agent", "edits");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(editsDir);
  } catch {
    return [];
  }

  const proposals: EditProposal[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const content = await fs.readFile(path.join(editsDir, entry), "utf8");
    proposals.push(JSON.parse(content));
  }
  return proposals;
}

export async function applyProposal(proposal: EditProposal): Promise<void> {
  const filePath = path.join(VAULT_PATH, proposal.filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  if (proposal.suggestedContent) {
    // Full replacement
    await fs.writeFile(filePath, proposal.suggestedContent, "utf8");
  }

  // Mark as applied
  const editsDir = path.join(VAULT_PATH, ".agent", "edits");
  await fs.writeFile(
    path.join(editsDir, `${proposal.id}.json`),
    JSON.stringify({ ...proposal, status: "applied" }, null, 2),
    "utf8",
  );
}

export async function hitlConfirm(proposal: EditProposal): Promise<boolean> {
  console.log(`\n=== Edit Proposal: ${proposal.title} ===`);
  console.log(`File: ${proposal.filePath}`);
  console.log(`Description: ${proposal.description}`);

  if (proposal.suggestedContent) {
    console.log(`\n--- Suggested Content (first 500 chars) ---`);
    console.log(proposal.suggestedContent.slice(0, 500));
    if (proposal.suggestedContent.length > 500) console.log("...(truncated)");
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("\nApply this edit? [y/N] ", (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}
