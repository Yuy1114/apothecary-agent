import { loadIntakePlan } from "../../vault/intakePlanStore.js";
import { createProposal, listProposals, saveProposal } from "../../vault/proposalStore.js";
import { resolveProposalRecord } from "../../domain/proposal.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";
import { nowIso } from "../../utils/time.js";

export type ProposeIntakeResult = {
  /** Set when a proposal was created; absent when the plan had nothing actionable. */
  proposalId?: string;
  /** Non-`leave` decisions in the plan. */
  actionable: number;
  /** Still-pending intake proposals this newer plan replaced. */
  superseded: number;
};

/**
 * Surface the organizer's current intake plan as an approvable `intake`
 * proposal instead of applying it — the consent gate for unattended intake.
 * Nothing moves until the human approves the proposal (工作区 standalone
 * proposal card → resolveProposalById → executeIntake on the reviewed snapshot).
 *
 * A newer plan supersedes any still-pending intake proposal (rejected with a
 * note) so at most one is open at a time; a plan whose every decision is
 * `leave` creates no proposal — there is nothing to consent to.
 */
export async function proposeIntakePlan(home: string = apothecaryHome()): Promise<ProposeIntakeResult> {
  const plan = await loadIntakePlan(home);
  const counts = { move: 0, archive: 0, leave: 0 };
  for (const decision of plan.decisions) counts[decision.action] += 1;
  const actionable = counts.move + counts.archive;
  if (actionable === 0) return { actionable, superseded: 0 };

  const pending = await listProposals(home, { status: "proposed", type: "intake" });
  for (const stale of pending) {
    await saveProposal(home, resolveProposalRecord(stale, "rejected", "superseded_by_newer_intake_plan", nowIso()));
  }

  const proposal = await createProposal(home, {
    type: "intake",
    title: `_inbox 整理计划：迁移 ${counts.move} · 归档 ${counts.archive} · 保留 ${counts.leave}`,
    rationale: "自动整理已在后台勘查 _inbox 并起草这份归位计划。文件尚未移动：采纳后才会执行，所有移动都会记录在案并可撤销。",
    payload: { decisions: plan.decisions },
  });
  return { proposalId: proposal.id, actionable, superseded: pending.length };
}
