import { z } from "zod";

/**
 * Unified proposal model. Every reviewable change to the human-readable layer —
 * regardless of action — is one durable Proposal with a single lifecycle
 * (proposed → applied | rejected). This is the governance record: it holds not
 * just what was proposed but how it was resolved (approval/rejection + note).
 *
 * v1 covers the maintenance-execution actions that have executors:
 * edit / move / archive / merge. Others in the roadmap (capture, canonical,
 * structure, view_promotion) can be added as new discriminated variants.
 */
export const ProposalTypeSchema = z.enum(["edit", "move", "archive", "merge"]);
export type ProposalType = z.infer<typeof ProposalTypeSchema>;

export const ProposalStatusSchema = z.enum(["proposed", "applied", "rejected"]);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const EditPayloadSchema = z.object({
  filePath: z.string().min(1),
  suggestedContent: z.string(),
});
export const MovePayloadSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});
export const ArchivePayloadSchema = z.object({
  from: z.string().min(1),
});
export const MergePayloadSchema = z.object({
  sourcePath: z.string().min(1),
  canonicalPath: z.string().min(1),
  canonicalContent: z.string().min(1),
});

/** Per-type payload validators, used when assembling a proposal from raw input. */
export const PAYLOAD_SCHEMAS = {
  edit: EditPayloadSchema,
  move: MovePayloadSchema,
  archive: ArchivePayloadSchema,
  merge: MergePayloadSchema,
} as const satisfies Record<ProposalType, z.ZodTypeAny>;

const baseFields = {
  id: z.string().min(1),
  status: ProposalStatusSchema,
  title: z.string().min(1),
  rationale: z.string(),
  targetFiles: z.array(z.string()),
  createdAt: z.string().min(1),
  resolvedAt: z.string().optional(),
  resolutionNote: z.string().optional(),
};

export const ProposalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("edit"), payload: EditPayloadSchema, ...baseFields }),
  z.object({ type: z.literal("move"), payload: MovePayloadSchema, ...baseFields }),
  z.object({ type: z.literal("archive"), payload: ArchivePayloadSchema, ...baseFields }),
  z.object({ type: z.literal("merge"), payload: MergePayloadSchema, ...baseFields }),
]);
export type Proposal = z.infer<typeof ProposalSchema>;

/** Distributive Pick: preserves the union's per-member correlation. */
type DistributivePick<T, K extends keyof T> = T extends unknown ? Pick<T, K> : never;

/**
 * A proposal's discriminating type + payload. A plain `Pick<Proposal, ...>`
 * would collapse the payload to the union of all shapes and break narrowing, so
 * this distributes over the union instead.
 */
export type ProposalAction = DistributivePick<Proposal, "type" | "payload">;

/** The files a proposal touches, derived from its payload (used for audit + display). */
export function deriveTargetFiles(input: ProposalAction): string[] {
  switch (input.type) {
    case "edit":
      return [input.payload.filePath];
    case "move":
      return [input.payload.from, input.payload.to];
    case "archive":
      return [input.payload.from];
    case "merge":
      return [input.payload.sourcePath, input.payload.canonicalPath];
  }
}

/**
 * Pure lifecycle transition: resolve a still-open proposal to applied or
 * rejected, stamping the decision. Throws if the proposal was already resolved,
 * so a proposal is never applied or rejected twice.
 */
export function resolveProposalRecord(
  proposal: Proposal,
  outcome: "applied" | "rejected",
  note: string | undefined,
  at: string,
): Proposal {
  if (proposal.status !== "proposed") {
    throw new Error(`Proposal ${proposal.id} is already ${proposal.status}.`);
  }
  return { ...proposal, status: outcome, resolvedAt: at, resolutionNote: note };
}
