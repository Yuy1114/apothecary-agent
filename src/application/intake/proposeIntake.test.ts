import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { recordIntakeDecision } from "../../vault/intakePlanStore.js";
import { listProposals, loadProposal } from "../../vault/proposalStore.js";
import { proposeIntakePlan } from "./proposeIntake.js";
import type { IntakeDecision } from "../../domain/intakePlan.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "apothecary-propose-intake-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function decision(o: Partial<IntakeDecision> & Pick<IntakeDecision, "source" | "action">): IntakeDecision {
  return { kind: "markdown", tags: [], confidence: 0.9, rationale: "r", decidedAt: "t", ...o };
}

describe("proposeIntakePlan", () => {
  it("creates no proposal when the plan is empty or all-leave", async () => {
    expect(await proposeIntakePlan(home)).toEqual({ actionable: 0, superseded: 0 });

    await recordIntakeDecision(decision({ source: "_inbox/keep.md", action: "leave", confidence: 0.3 }), home);
    const leaveOnly = await proposeIntakePlan(home);
    expect(leaveOnly.proposalId).toBeUndefined();
    expect(await listProposals(home)).toHaveLength(0);
  });

  it("wraps the plan into a pending intake proposal holding the reviewed snapshot", async () => {
    await recordIntakeDecision(decision({ source: "_inbox/a.md", action: "move", dest: "notes/" }), home);
    await recordIntakeDecision(decision({ source: "_inbox/b.md", action: "archive" }), home);
    await recordIntakeDecision(decision({ source: "_inbox/keep.md", action: "leave", confidence: 0.3 }), home);

    const result = await proposeIntakePlan(home);

    expect(result.actionable).toBe(2);
    const proposal = await loadProposal(home, result.proposalId!);
    if (proposal?.type !== "intake") throw new Error("expected an intake proposal");
    expect(proposal.status).toBe("proposed");
    // The whole plan (including `leave`) is snapshotted so the review shows why
    // entries stay put; targets include the move destination.
    expect(proposal.payload.decisions).toHaveLength(3);
    expect(proposal.targetFiles).toEqual(
      expect.arrayContaining(["_inbox/a.md", "notes/a.md", "_inbox/b.md", "_inbox/keep.md"]),
    );
    // Nothing here touches files — proposing is consent-gathering only.
  });

  it("a newer plan supersedes the still-pending intake proposal", async () => {
    await recordIntakeDecision(decision({ source: "_inbox/a.md", action: "move", dest: "notes/" }), home);
    const first = await proposeIntakePlan(home);

    await recordIntakeDecision(decision({ source: "_inbox/c.md", action: "archive" }), home);
    const second = await proposeIntakePlan(home);

    expect(second.superseded).toBe(1);
    const stale = await loadProposal(home, first.proposalId!);
    expect(stale?.status).toBe("rejected");
    expect(stale?.resolutionNote).toBe("superseded_by_newer_intake_plan");
    expect((await loadProposal(home, second.proposalId!))?.status).toBe("proposed");
  });
});
