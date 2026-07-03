import { promises as fs } from "node:fs";
import path from "node:path";
import { getAgentArtifacts } from "../artifacts/agentArtifacts.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";
import {
  ProposalSchema,
  PAYLOAD_SCHEMAS,
  deriveTargetFiles,
  type Proposal,
  type ProposalAction,
  type ProposalType,
  type ProposalStatus,
} from "../domain/proposal.js";

/** Durable, unified proposal store: one JSON file per proposal under .agent/proposals. */
function proposalsDir(vaultPath: string): string {
  return path.join(getAgentArtifacts(vaultPath).rootPath, "proposals");
}

function proposalPath(vaultPath: string, id: string): string {
  return path.join(proposalsDir(vaultPath), `${id}.json`);
}

export async function saveProposal(vaultPath: string, proposal: Proposal): Promise<void> {
  const filePath = proposalPath(vaultPath, proposal.id);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(proposal, null, 2), "utf8");
}

export async function loadProposal(vaultPath: string, id: string): Promise<Proposal | null> {
  try {
    return ProposalSchema.parse(JSON.parse(await fs.readFile(proposalPath(vaultPath, id), "utf8")));
  } catch {
    return null;
  }
}

export async function listProposals(
  vaultPath: string,
  filter: { status?: ProposalStatus; type?: ProposalType } = {},
): Promise<Proposal[]> {
  let names: string[];
  try {
    names = (await fs.readdir(proposalsDir(vaultPath))).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }

  const proposals: Proposal[] = [];
  for (const name of names) {
    try {
      const proposal = ProposalSchema.parse(
        JSON.parse(await fs.readFile(path.join(proposalsDir(vaultPath), name), "utf8")),
      );
      if (filter.status && proposal.status !== filter.status) continue;
      if (filter.type && proposal.type !== filter.type) continue;
      proposals.push(proposal);
    } catch {
      // Skip malformed proposal files rather than failing the whole listing.
    }
  }

  return proposals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Build, validate, and persist a new proposal in the `proposed` state. Validates
 * the payload against its declared type (throws on mismatch) and derives the
 * affected files from it, so callers cannot record an inconsistent proposal.
 */
export async function createProposal(
  vaultPath: string,
  input: { type: ProposalType; title: string; rationale: string; payload: unknown },
): Promise<Proposal> {
  const payload = PAYLOAD_SCHEMAS[input.type].parse(input.payload);
  const proposal = ProposalSchema.parse({
    id: `prop-${createId("proposal")}`,
    type: input.type,
    status: "proposed" satisfies ProposalStatus,
    title: input.title,
    rationale: input.rationale,
    payload,
    targetFiles: deriveTargetFiles({ type: input.type, payload } as ProposalAction),
    createdAt: nowIso(),
  });
  await saveProposal(vaultPath, proposal);
  return proposal;
}
