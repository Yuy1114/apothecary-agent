import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadIntakePlan, recordIntakeDecision, clearIntakePlan } from "./intakePlanStore.js";
import type { IntakeDecision } from "../domain/intakePlan.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function freshHome(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "apothecary-intake-plan-"));
  dirs.push(dir);
  return dir;
}

function decision(source: string, extra: Partial<IntakeDecision> = {}): IntakeDecision {
  return {
    source,
    kind: "markdown",
    action: "move",
    dest: "notes/",
    tags: ["programming"],
    confidence: 0.9,
    rationale: "技术笔记",
    decidedAt: "2026-07-05T00:00:00.000Z",
    ...extra,
  };
}

describe("intakePlanStore", () => {
  it("defaults to an empty plan", async () => {
    expect(await loadIntakePlan(await freshHome())).toEqual({ generatedAt: "", updatedAt: "", decisions: [] });
  });

  it("records decisions, upserts by source, and keeps them sorted", async () => {
    const home = await freshHome();
    const r1 = await recordIntakeDecision(decision("_inbox/b.md"), home);
    expect(r1.total).toBe(1);
    await recordIntakeDecision(decision("_inbox/a.md"), home);

    // Re-record the same source with a different decision — should overwrite, not duplicate.
    const r3 = await recordIntakeDecision(decision("_inbox/b.md", { action: "leave", confidence: 0.4 }), home);
    expect(r3.total).toBe(2);

    const plan = await loadIntakePlan(home);
    expect(plan.decisions.map((d) => d.source)).toEqual(["_inbox/a.md", "_inbox/b.md"]);
    expect(plan.decisions.find((d) => d.source === "_inbox/b.md")?.action).toBe("leave");
    expect(plan.generatedAt).not.toBe("");
  });

  it("clears the plan", async () => {
    const home = await freshHome();
    await recordIntakeDecision(decision("_inbox/a.md"), home);
    await clearIntakePlan(home);
    expect(await loadIntakePlan(home)).toEqual({ generatedAt: "", updatedAt: "", decisions: [] });
  });
});
