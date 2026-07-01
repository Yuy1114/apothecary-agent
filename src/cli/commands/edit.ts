import type { Command } from "commander";
import { listProposals, applyProposal, hitlConfirm } from "../hitl.js";

export function registerEditCommands(program: Command): void {
  const edits = program.command("edits").description("Manage edit proposals from the agent");

  edits
    .command("list")
    .description("List pending edit proposals")
    .action(async () => {
      const proposals = await listProposals();
      const pending = proposals.filter((p) => p.status === "proposed");

      if (pending.length === 0) {
        console.log("No pending edit proposals.");
        return;
      }

      for (const p of pending) {
        console.log(`[${p.id}] ${p.title} → ${p.filePath}`);
      }
      console.log(`\nRun 'edits apply <id>' to review and apply a proposal.`);
    });

  edits
    .command("apply")
    .description("Review and apply an edit proposal")
    .argument("<id>", "Proposal ID")
    .action(async (id: string) => {
      const proposals = await listProposals();
      const proposal = proposals.find((p) => p.id === id);

      if (!proposal) {
        console.log(`Proposal ${id} not found.`);
        return;
      }

      if (proposal.status !== "proposed") {
        console.log(`Proposal ${id} is already ${proposal.status}.`);
        return;
      }

      const confirmed = await hitlConfirm(proposal);
      if (confirmed) {
        await applyProposal(proposal);
        console.log("Edit applied.");
      } else {
        console.log("Edit rejected.");
      }
    });
}
