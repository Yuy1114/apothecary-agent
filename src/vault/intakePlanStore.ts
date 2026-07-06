import { promises as fs } from "node:fs";
import path from "node:path";
import { getAgentArtifacts } from "../artifacts/agentArtifacts.js";
import { apothecaryHome } from "../config/apothecaryHome.js";
import { nowIso } from "../utils/time.js";
import {
  EMPTY_INTAKE_PLAN,
  IntakePlanSchema,
  upsertDecision,
  type IntakeDecision,
  type IntakePlan,
} from "../domain/intakePlan.js";

/**
 * Durable store for the cold-start intake plan, one JSON file in the agent's
 * queue dir (`~/.apothecary/queue/intake-plan.json`). The organizer records one
 * decision per _inbox entry here as it goes, so progress survives interruption
 * and the whole plan is reviewable before execution.
 */
function planPath(home: string): string {
  return path.join(getAgentArtifacts(home).queueDir, "intake-plan.json");
}

export async function loadIntakePlan(home: string = apothecaryHome()): Promise<IntakePlan> {
  try {
    return IntakePlanSchema.parse(JSON.parse(await fs.readFile(planPath(home), "utf8")));
  } catch {
    return EMPTY_INTAKE_PLAN;
  }
}

async function saveIntakePlan(home: string, plan: IntakePlan): Promise<void> {
  const filePath = planPath(home);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // Atomic write: full file to a temp path, then rename over the target, so a
  // crash or overlapping write can never leave a half-written/corrupt JSON.
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(plan, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

// The model may emit parallel recordDecision tool calls in one turn; serialize
// the read-modify-write here (in-process) so concurrent upserts don't race.
let writeChain: Promise<unknown> = Promise.resolve();

/** Record (upsert by source) one decision and return the updated plan + count. */
export async function recordIntakeDecision(
  decision: IntakeDecision,
  home: string = apothecaryHome(),
): Promise<{ plan: IntakePlan; total: number }> {
  const run = writeChain.then(async () => {
    const existing = await loadIntakePlan(home);
    const now = nowIso();
    const base: IntakePlan =
      existing.generatedAt === "" ? { generatedAt: now, updatedAt: now, decisions: [] } : existing;
    const plan = { ...upsertDecision(base, decision), updatedAt: now };
    await saveIntakePlan(home, plan);
    return plan;
  });
  writeChain = run.catch(() => undefined);
  const plan = await run;
  return { plan, total: plan.decisions.length };
}

export async function clearIntakePlan(home: string = apothecaryHome()): Promise<void> {
  await fs.rm(planPath(home), { force: true });
}
