import { promises as fs } from "node:fs";
import path from "node:path";
import { moveVaultFileCore } from "./move-vault-file-core.js";
import { archiveVaultFileCore } from "./archive-vault-file-core.js";
import { reindexFile } from "./rag.js";
import { addFrontmatterTags } from "../../vault/frontmatter.js";
import { safeVaultPath } from "../../safety/pathSafety.js";
import { loadIntakePlan, clearIntakePlan } from "../../vault/intakePlanStore.js";
import type { IntakeDecision } from "../../domain/intakePlan.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export type ExecuteIntakeReport = {
  total: number;
  moved: number;
  archived: number;
  left: number;
  failed: number;
  failures: { source: string; reason: string }[];
};

/** dest (a directory) + rename|basename → the vault-relative target path. */
function targetPath(decision: IntakeDecision): string {
  const base = decision.rename?.trim() || path.posix.basename(decision.source);
  const dir = (decision.dest ?? "").replace(/\/+$/, "");
  return dir ? path.posix.join(dir, base) : base;
}

/** Best-effort: stamp the decision's tags onto a moved markdown note's frontmatter. */
async function applyTags(target: string, tags: string[]): Promise<void> {
  if (!target.endsWith(".md") || tags.length === 0) return;
  const abs = safeVaultPath(VAULT_PATH, target);
  if (!abs) return;
  try {
    const content = await fs.readFile(abs, "utf8");
    const next = addFrontmatterTags(content, tags);
    if (next !== content) {
      await fs.writeFile(abs, next, "utf8");
      await reindexFile(target);
    }
  } catch {
    // Tagging is a nice-to-have; never fail a completed move over it.
  }
}

/**
 * Apply the reviewed intake plan: for each decision, move / archive / leave the
 * _inbox file, tagging moved markdown. Reuses the audited move & archive cores
 * (RAG index + operation ledger stay in sync; nothing is ever overwritten or
 * deleted). The plan is consumed on completion — the _inbox filesystem is the
 * source of truth, so re-running the organizer re-plans whatever remains.
 *
 * Does NOT rebuild the semantic layer (that is a separate, cost-bearing pass);
 * run a semantic refresh afterward to bring understanding up to date.
 */
export async function executeIntake(): Promise<ExecuteIntakeReport> {
  const plan = await loadIntakePlan();
  const report: ExecuteIntakeReport = {
    total: plan.decisions.length,
    moved: 0,
    archived: 0,
    left: 0,
    failed: 0,
    failures: [],
  };

  for (const decision of plan.decisions) {
    try {
      if (decision.action === "leave") {
        report.left += 1;
        continue;
      }
      if (decision.action === "archive") {
        const result = await archiveVaultFileCore(decision.source, { reason: decision.rationale });
        if (result.archived) report.archived += 1;
        else report.failures.push({ source: decision.source, reason: result.reason ?? "archive_failed" });
        continue;
      }
      // move
      const to = targetPath(decision);
      const result = await moveVaultFileCore(decision.source, to);
      if (result.moved) {
        report.moved += 1;
        await applyTags(to, decision.tags);
      } else {
        report.failures.push({ source: decision.source, reason: result.reason ?? "move_failed" });
      }
    } catch (error) {
      report.failures.push({ source: decision.source, reason: error instanceof Error ? error.message : "error" });
    }
  }

  report.failed = report.failures.length;
  await clearIntakePlan();
  return report;
}
