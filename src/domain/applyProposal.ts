import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resolveExistingDirectory } from "../safety/pathSafety.js";

export const EditProposalSchema = z.object({
  id: z.string().min(1),
  filePath: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  currentContent: z.string(),
  suggestedContent: z.string(),
  status: z.enum(["proposed", "applied", "rejected"]),
  createdAt: z.string(),
});

export type EditProposal = z.infer<typeof EditProposalSchema>;

export type ApplyProposalResult = {
  proposalId: string;
  filePath: string;
  applied: boolean;
  status: "applied";
};

function proposalPath(vaultPath: string, proposalId: string): string {
  return path.join(vaultPath, ".agent", "edits", `${proposalId}.json`);
}

/**
 * Load an edit proposal, validate it is still `proposed`, write its suggested
 * content to the target vault file, and mark the proposal `applied`.
 *
 * Shared by the apply-edit workflow (Studio/suspend-resume approval) and the
 * curator's applyEdit tool (agent-native requireApproval).
 */
export async function applyProposal({
  vaultPath,
  proposalId,
}: {
  vaultPath: string;
  proposalId: string;
}): Promise<ApplyProposalResult> {
  const resolvedVault = await resolveExistingDirectory(vaultPath);
  const proposal = EditProposalSchema.parse(
    JSON.parse(await fs.readFile(proposalPath(resolvedVault, proposalId), "utf8")),
  );

  if (proposal.status !== "proposed") {
    throw new Error(`Proposal ${proposal.id} is already ${proposal.status}.`);
  }

  const targetPath = path.join(resolvedVault, proposal.filePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  if (proposal.suggestedContent) {
    await fs.writeFile(targetPath, proposal.suggestedContent, "utf8");
  }

  await fs.writeFile(
    proposalPath(resolvedVault, proposal.id),
    JSON.stringify({ ...proposal, status: "applied" satisfies EditProposal["status"] }, null, 2),
    "utf8",
  );

  return {
    proposalId: proposal.id,
    filePath: proposal.filePath,
    applied: true,
    status: "applied",
  };
}
