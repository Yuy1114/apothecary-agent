import { promises as fs } from "node:fs";
import path from "node:path";
import { moveVaultFileCore } from "./move-vault-file-core.js";
import { archiveVaultFileCore } from "./archive-vault-file-core.js";
import { searchIndex } from "../../application/ports/searchIndex.js";
import { addFrontmatterTags } from "../../vault/frontmatter.js";
import { recordOperation } from "../../vault/operationLedger.js";
import { safeVaultPath } from "../../safety/pathSafety.js";
import { markSelfWrite } from "../../vault/selfWriteGuard.js";
import { commitSelfWrite } from "../../vault/syncSnapshot.js";
import { loadIntakePlan, clearIntakePlan } from "../../vault/intakePlanStore.js";
import { resolvePendingByPaths } from "../../vault/changeLog.js";
import type { IntakeDecision } from "../../domain/intakePlan.js";
import { logger, startTimer } from "../../observability/logger.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export type ExecuteIntakeReport = {
  total: number;
  moved: number;
  archived: number;
  left: number;
  failed: number;
  failures: { source: string; reason: string }[];
  // Every path this batch touched (move sources + targets, archive sources,
  // directory-merge endpoints) — the set a follow-on semantic refresh needs so
  // moved notes get re-summarized and vacated `_inbox` paths pruned. `leave`
  // sources are excluded: nothing about them changed on disk.
  affected: string[];
};

/** dest (a directory) + rename|basename → the vault-relative target path (files only). */
function fileTargetPath(decision: IntakeDecision): string {
  const base = decision.rename?.trim() || path.posix.basename(decision.source);
  const dir = (decision.dest ?? "").replace(/\/+$/, "");
  return dir ? path.posix.join(dir, base) : base;
}

async function pathExists(abs: string): Promise<boolean> {
  return fs.access(abs).then(() => true, () => false);
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
      await searchIndex().reindexFile(target);
    }
  } catch {
    // Tagging is a nice-to-have; never fail a completed move over it.
  }
}

/** Remove directories that are empty after a merge (bottom-up); never touches files. */
async function removeEmptyDirs(abs: string): Promise<void> {
  const entries = await fs.readdir(abs, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) await removeEmptyDirs(path.join(abs, entry.name));
  }
  await fs.rmdir(abs).catch(() => undefined); // succeeds only when empty
}

/**
 * Merge a directory's contents INTO `destDir` (not nested under it): each file
 * moves to `destDir/<path-relative-to-source>`. Existing targets are skipped
 * (never overwritten); emptied source dirs are pruned. `dest` for a directory
 * decision is the target directory itself (e.g. `resources/books/`), so we must
 * not append the source's basename or it would double-nest.
 */
async function moveDirectoryInto(
  sourceRel: string,
  destDirRel: string,
  affected: Set<string>,
): Promise<{ ok: boolean; reason?: string; skipped: number }> {
  const srcAbs = safeVaultPath(VAULT_PATH, sourceRel);
  const destAbs = safeVaultPath(VAULT_PATH, destDirRel || sourceRel);
  if (!srcAbs || !destAbs) return { ok: false, reason: "unsafe_path", skipped: 0 };

  const toRel = (abs: string) => path.relative(VAULT_PATH, abs).split(path.sep).join("/");
  let skipped = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const target = path.join(destAbs, path.relative(srcAbs, abs));
      if (entry.isDirectory()) {
        await fs.mkdir(target, { recursive: true });
        await walk(abs);
      } else if (await pathExists(target)) {
        skipped += 1; // never overwrite
      } else {
        const relSource = toRel(abs);
        const relTarget = toRel(target);
        // Mark both endpoints self-writes before the rename so the watcher's
        // event for either lands on a registered path and is skipped.
        markSelfWrite([relSource, relTarget]);
        affected.add(relSource);
        affected.add(relTarget);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rename(abs, target);
        // Best-effort index sync: a slow/unreachable embedding endpoint must not
        // hang or fail the completed move (see moveVaultFileCore).
        if (relTarget.endsWith(".md")) await searchIndex().reindexFile(relTarget).catch(() => undefined);
      }
    }
  };

  await walk(srcAbs);
  await removeEmptyDirs(srcAbs);
  await recordOperation({
    type: "move",
    targetFiles: [sourceRel, destDirRel],
    source: "executeIntake",
    detail: `${sourceRel}/* → ${destDirRel}/${skipped ? ` (${skipped} skipped)` : ""}`,
  });
  return { ok: true, skipped };
}

/**
 * Apply the reviewed intake plan: for each decision, move / archive / leave the
 * _inbox entry, tagging moved markdown. Directory entries merge their contents
 * into the target dir. Reuses the audited move & archive cores (RAG index +
 * operation ledger stay in sync; nothing is overwritten or deleted). The plan is
 * consumed on completion — the _inbox filesystem is the source of truth, so
 * re-running the organizer re-plans whatever remains.
 *
 * Does NOT rebuild the semantic layer (a separate, cost-bearing pass); run a
 * semantic refresh afterward to bring understanding up to date.
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
    affected: [],
  };
  const doneAll = startTimer("intake", `executeIntake (${plan.decisions.length} decisions)`);
  logger.info("intake", `start · ${plan.decisions.length} decisions`);

  // Every path this batch touches, so the change baseline can be updated once at
  // the end — keeping the watcher and manual sync from re-flagging these system
  // moves as external edits.
  const affected = new Set<string>();

  for (const decision of plan.decisions) {
    const done = startTimer("intake", `${decision.action} ${decision.source}`);
    try {
      if (decision.action === "leave") {
        report.left += 1;
        continue;
      }
      if (decision.action === "archive") {
        markSelfWrite([decision.source]);
        affected.add(decision.source);
        const result = await archiveVaultFileCore(decision.source, { reason: decision.rationale });
        if (result.archived) report.archived += 1;
        else report.failures.push({ source: decision.source, reason: result.reason ?? "archive_failed" });
        continue;
      }

      // move — directory sources merge their contents; files rename+move.
      const srcAbs = safeVaultPath(VAULT_PATH, decision.source);
      const stat = srcAbs ? await fs.stat(srcAbs).catch(() => null) : null;
      if (!stat) {
        report.failures.push({ source: decision.source, reason: "missing_source" });
        continue;
      }
      if (stat.isDirectory()) {
        const result = await moveDirectoryInto(decision.source, (decision.dest ?? "").replace(/\/+$/, ""), affected);
        if (result.ok) report.moved += 1;
        else report.failures.push({ source: decision.source, reason: result.reason ?? "move_failed" });
      } else {
        const to = fileTargetPath(decision);
        markSelfWrite([decision.source, to]);
        affected.add(decision.source);
        affected.add(to);
        const result = await moveVaultFileCore(decision.source, to);
        if (result.moved) {
          report.moved += 1;
          await applyTags(to, decision.tags);
        } else {
          report.failures.push({ source: decision.source, reason: result.reason ?? "move_failed" });
        }
      }
    } catch (error) {
      report.failures.push({ source: decision.source, reason: error instanceof Error ? error.message : "error" });
    } finally {
      done();
    }
  }

  report.failed = report.failures.length;
  // Record the batch's final on-disk state in the baseline (sources dropped,
  // targets hashed) and release the pending self-write marks.
  await commitSelfWrite(VAULT_PATH, affected);
  // Clear pending changes for every path this batch handled (moves/archives are
  // also cleared in their cores; this additionally covers directory merges and
  // `leave` decisions) so processed inbox files don't linger as stale changes.
  await resolvePendingByPaths([...affected, ...plan.decisions.map((d) => d.source)]);
  await clearIntakePlan();
  report.affected = [...affected];
  doneAll({ moved: report.moved, archived: report.archived, left: report.left, failed: report.failed });
  return report;
}
