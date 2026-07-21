import { z } from "zod";
import { InboxEntryKindSchema } from "./inboxSurvey.js";

/**
 * The cold-start intake plan: the organizer subagent's per-entry placement
 * decisions for `_inbox`, persisted so "every entry has a decision" is durable
 * and resumable, and so a human can review the whole plan before anything moves.
 * Nothing here touches files — execution is a separate, approved step.
 */

export const IntakeActionSchema = z.enum(["move", "archive", "leave"]);
export type IntakeAction = z.infer<typeof IntakeActionSchema>;

export const IntakeDecisionSchema = z.object({
  /** Vault-relative `_inbox` path of the entry this decision is for. */
  source: z.string().min(1),
  /** The survey kind this decision was made for. */
  kind: InboxEntryKindSchema,
  /** move → relocate into `dest`; archive → retire to archive/; leave → keep in _inbox. */
  action: IntakeActionSchema,
  /** Target skeleton directory for a move, e.g. `notes/`, `areas/career/`, `media/screenshots/`. */
  dest: z.string().optional(),
  /** New filename (optional; defaults to the source basename on execute). */
  rename: z.string().optional(),
  /** Frontmatter tags to add (e.g. path topics for a flattened note). */
  tags: z.array(z.string()).default([]),
  /** 0–1. Below the charter threshold the organizer should choose action="leave". */
  confidence: z.number().min(0).max(1),
  /** Short, concrete reason (Chinese) — shown to the human in the plan review. */
  rationale: z.string().min(1),
  decidedAt: z.string(),
});
export type IntakeDecision = z.infer<typeof IntakeDecisionSchema>;

export const IntakePlanSchema = z.object({
  generatedAt: z.string(),
  updatedAt: z.string(),
  decisions: z.array(IntakeDecisionSchema),
});
export type IntakePlan = z.infer<typeof IntakePlanSchema>;

export const EMPTY_INTAKE_PLAN: IntakePlan = { generatedAt: "", updatedAt: "", decisions: [] };

/**
 * dest (a directory) + rename|basename → the vault-relative target path for a
 * FILE move decision (directory sources merge into `dest` itself). Pure; shared
 * by execution and by proposal display/target derivation.
 */
export function fileTargetPath(decision: IntakeDecision): string {
  const base = decision.rename?.trim() || decision.source.split("/").filter(Boolean).at(-1) || decision.source;
  const dir = (decision.dest ?? "").replace(/\/+$/, "");
  return dir ? `${dir}/${base}` : base;
}

/** A single intake decision, shaped for the desktop proposal preview. */
export type IntakeDecisionView = {
  action: IntakeAction;
  /** Vault-relative source (with a trailing `/*` for a folder move). */
  source: string;
  /** Destination path for move/archive; absent for `leave` (stays put). */
  target?: string;
  rationale: string;
  confidence: number;
};

const INTAKE_ACTION_ORDER: Record<IntakeAction, number> = { move: 0, archive: 1, leave: 2 };

/**
 * Project intake decisions into a structured preview list — which file, from→to,
 * and why — so the desktop can show a clear participant plan instead of collapsing
 * every source/target basename into look-alike chips. Intake only ever MOVES files
 * (content is never rewritten), so no before/after is produced. Actionable moves
 * lead, archives next, kept-in-place last; ties broken by source path. Pure.
 */
export function buildIntakeDecisionViews(decisions: IntakeDecision[]): IntakeDecisionView[] {
  return decisions
    .map((d): IntakeDecisionView => {
      const base = { action: d.action, source: d.source, rationale: d.rationale, confidence: d.confidence };
      if (d.action === "archive") return { ...base, target: "archive/" };
      if (d.action === "leave") return base;
      return d.kind === "directory"
        ? { ...base, source: `${d.source}/*`, target: d.dest ?? "" }
        : { ...base, target: fileTargetPath(d) };
    })
    .sort((a, b) => INTAKE_ACTION_ORDER[a.action] - INTAKE_ACTION_ORDER[b.action] || a.source.localeCompare(b.source));
}

/** Upsert a decision by `source` (last write wins) — pure. */
export function upsertDecision(plan: IntakePlan, decision: IntakeDecision): IntakePlan {
  const decisions = plan.decisions.filter((d) => d.source !== decision.source);
  decisions.push(decision);
  decisions.sort((a, b) => a.source.localeCompare(b.source));
  return { ...plan, decisions };
}
