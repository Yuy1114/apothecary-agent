/**
 * The observable phase of the background auto-intake pass. The vault watcher's
 * scheduler is the single source of truth (see sync-watcher.ts); the desktop
 * surfaces this so the user can perceive the trigger→proposal time lag instead
 * of a black box. Pure data — safe to share across the mastra/application layers.
 *
 * Lifecycle:
 *   idle ──trigger──▶ scheduled(debouncing) ──settle──▶ planning
 *     ▲                                                    │
 *     └──── no actionable ◀── proposed ◀── proposalId ─────┤
 *                              failed ◀── error ───────────┘
 *   (a drop arriving mid-pass re-enters `scheduled` once the pass settles)
 */
export type AutoIntakePhase = "idle" | "scheduled" | "planning" | "proposed" | "failed";

export type AutoIntakeStatus = {
  phase: AutoIntakePhase;
  /** What kicked off the current/last pass. */
  trigger?: "drop" | "startup";
  /** ISO time the current phase was entered. */
  since: string;
  /** Set on `proposed`: the intake proposal now awaiting approval. */
  lastProposalId?: string;
  /** Set on `proposed`: actionable (move+archive) decisions in that plan. */
  actionable?: number;
  /** Set on `failed`: the last error's message. */
  lastError?: string;
};
