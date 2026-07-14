import { z } from "zod";
import { IntakeDecisionSchema, fileTargetPath } from "./intakePlan.js";

/**
 * Unified proposal model. Every reviewable change to the human-readable layer —
 * regardless of action — is one durable Proposal with a single lifecycle
 * (proposed → applied | rejected). This is the governance record: it holds not
 * just what was proposed but how it was resolved (approval/rejection + note).
 *
 * Covers every action that has an executor: the maintenance actions
 * (edit / move / archive / merge), the knowledge-entry actions
 * (capture / structure / view_promotion), canonicalization (canonical_note),
 * and batch inbox filing (intake — the organizer's whole plan as one review).
 */
export const ProposalTypeSchema = z.enum([
  "edit",
  "move",
  "archive",
  "merge",
  "capture",
  "structure",
  "view_promotion",
  "canonical_note",
  "intake",
]);
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
/** Capture a synthesized insight into a new note; destination classified at apply time. */
export const CapturePayloadSchema = z.object({
  content: z.string().min(1),
  /** Optional directory hint/key; the note's title is derived from the content. */
  topic: z.string().optional(),
});
/** Update classification keywords for an existing directory in structure.yaml. */
export const StructurePayloadSchema = z.object({
  directory: z.string().min(1),
  add: z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
});
/** Promote a generated `.agent/views/` view into a permanent vault note. */
export const ViewPromotionPayloadSchema = z.object({
  sourceViewPath: z.string().min(1),
  targetPath: z.string().min(1),
  content: z.string().min(1),
});
/**
 * Create/update the canonical note for a concept and mark the notes it replaces
 * as superseded (a directed link stamped into their frontmatter).
 */
export const CanonicalNotePayloadSchema = z.object({
  canonicalPath: z.string().min(1),
  content: z.string().min(1),
  supersedes: z.array(z.string()).default([]),
});
/**
 * A snapshot of the organizer's intake plan awaiting consent. Approval applies
 * exactly these decisions (not whatever the live plan store holds by then), so
 * what the human reviewed is what executes.
 */
export const IntakePayloadSchema = z.object({
  decisions: z.array(IntakeDecisionSchema).min(1),
});

/** Per-type payload validators, used when assembling a proposal from raw input. */
export const PAYLOAD_SCHEMAS = {
  edit: EditPayloadSchema,
  move: MovePayloadSchema,
  archive: ArchivePayloadSchema,
  merge: MergePayloadSchema,
  capture: CapturePayloadSchema,
  structure: StructurePayloadSchema,
  view_promotion: ViewPromotionPayloadSchema,
  canonical_note: CanonicalNotePayloadSchema,
  intake: IntakePayloadSchema,
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
  z.object({ type: z.literal("capture"), payload: CapturePayloadSchema, ...baseFields }),
  z.object({ type: z.literal("structure"), payload: StructurePayloadSchema, ...baseFields }),
  z.object({ type: z.literal("view_promotion"), payload: ViewPromotionPayloadSchema, ...baseFields }),
  z.object({ type: z.literal("canonical_note"), payload: CanonicalNotePayloadSchema, ...baseFields }),
  z.object({ type: z.literal("intake"), payload: IntakePayloadSchema, ...baseFields }),
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
    case "capture":
      // The exact filename is decided at apply time; show the directory hint if given.
      return input.payload.topic ? [input.payload.topic] : [];
    case "structure":
      return [input.payload.directory];
    case "view_promotion":
      return [input.payload.sourceViewPath, input.payload.targetPath];
    case "canonical_note":
      return [input.payload.canonicalPath, ...input.payload.supersedes];
    case "intake": {
      const files = new Set<string>();
      for (const decision of input.payload.decisions) {
        files.add(decision.source);
        if (decision.action !== "move") continue;
        // File moves land at dest/basename; directory sources merge INTO dest.
        files.add(decision.kind === "directory" ? (decision.dest ?? decision.source) : fileTargetPath(decision));
      }
      return [...files];
    }
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
