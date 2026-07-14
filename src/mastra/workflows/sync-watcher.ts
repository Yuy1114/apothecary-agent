import type { Mastra } from "@mastra/core/mastra";
import { promises as fs } from "node:fs";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { enqueueChange } from "../../vault/changeLog.js";
import { isSelfWrite } from "../../vault/selfWriteGuard.js";
import { isArchivedPath } from "../../vault/archive.js";
import { hashFile } from "../../vault/hash.js";
import { loadSnapshot, commitSelfWrite } from "../../vault/syncSnapshot.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";
import { syncSemanticsFromChanges } from "../../application/semantic/syncSemanticsFromChanges.js";
import { proposeIntakePlan } from "../../application/intake/proposeIntake.js";

export type WatchClassification = "unchanged" | "created" | "modified" | "deleted";

/**
 * Classify a watcher event by comparing the file's current content hash against
 * the sync baseline. Pure and deterministic (mirrors `diffSnapshot`): a null
 * current hash means the file is gone; a null baseline hash means it was not
 * previously accounted for. An unregistered path is external work iff its
 * content no longer matches the baseline.
 */
export function classifyWatchEvent(
  currentHash: string | null,
  baselineHash: string | null,
): WatchClassification {
  if (currentHash === null) return baselineHash === null ? "unchanged" : "deleted";
  if (baselineHash === null) return "created";
  return currentHash === baselineHash ? "unchanged" : "modified";
}

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

// The frozen vault skeleton names the intake folder `_inbox` (see classifyLayer
// / the organizer agent). Content landing here is a candidate for auto-intake.
const INBOX_PREFIX = "_inbox/";

// Debounce the semantic refresh: a save burst (or a batch import) should settle
// into a single incremental pass rather than one LLM summary run per fs event.
const SEMANTIC_SYNC_DEBOUNCE_MS = Number(
  process.env.APOTHECARY_SEMANTIC_SYNC_DEBOUNCE_MS ?? 8_000,
);

// Debounce auto-intake a little longer than the semantic pass so a drop-burst
// (and the eager reindex it triggers) settles before the organizer surveys.
const AUTO_INTAKE_DEBOUNCE_MS = Number(
  process.env.APOTHECARY_AUTO_INTAKE_DEBOUNCE_MS ?? 12_000,
);

let watcher: FSWatcher | null = null;
let semanticSyncTimer: ReturnType<typeof setTimeout> | null = null;
let semanticSyncRunning = false;
let semanticSyncPending = false;
let autoIntakeTimer: ReturnType<typeof setTimeout> | null = null;
let autoIntakeRunning = false;
let autoIntakePending = false;

function toPortablePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isMarkdownPath(p: string): boolean {
  return p.endsWith(".md");
}

function isIgnoredPath(relativePath: string): boolean {
  // Dotfiles/dirs (.agent, .obsidian, …) and the archive subtree are not active
  // vault content — archived notes must not re-enter the change→semantic pipeline.
  return relativePath.startsWith(".") || isArchivedPath(relativePath);
}

/**
 * A watcher event should trigger auto-intake iff the feature is opted in and the
 * change landed inside `_inbox` (the only place a new drop should be filed from).
 * Pure so the trigger rule is unit-tested without spinning up an fs watcher.
 */
export function shouldScheduleAutoIntake(relativePath: string, enabled: boolean): boolean {
  return enabled && relativePath.startsWith(INBOX_PREFIX);
}

// Opt-in (see settingsEnv → APOTHECARY_AUTO_INTAKE): the background pass costs
// LLM calls, so it stays off unless enabled. It only PLANS — every move still
// waits for the human to approve the resulting intake proposal.
function autoIntakeEnabled(): boolean {
  return process.env.APOTHECARY_AUTO_INTAKE === "1";
}

// Mastra.getWorkflow() resolves by registration key (see index.ts), NOT the
// workflow's internal id. These must match the keys used when registering.
const FILE_CHANGED_WORKFLOW = "fileChangedWorkflow";
const FILE_DELETED_WORKFLOW = "fileDeletedWorkflow";

async function syncChange(mastra: Mastra, relativePath: string): Promise<void> {
  // A system operation is mid-write on this path: it owns the index, ledger and
  // baseline for it, so the watcher must stay out entirely.
  if (isSelfWrite(relativePath)) return;

  const absolutePath = path.join(VAULT_PATH, relativePath);

  // Hash the current content (null = gone) and compare against the baseline.
  // Only a genuine mismatch — new file, changed content, or a deletion — counts
  // as external work; a self-write echo already matches the baseline.
  let currentHash: string | null = null;
  try {
    if ((await fs.stat(absolutePath)).isFile()) currentHash = await hashFile(absolutePath);
  } catch {
    currentHash = null;
  }

  const baseline = await loadSnapshot(apothecaryHome());
  const classification = classifyWatchEvent(currentHash, baseline.files[relativePath]?.hash ?? null);
  if (classification === "unchanged") return;

  // Isolated from the stat above so a workflow failure is never mistaken for a
  // deletion, and never escapes as an unhandled rejection that crashes the host.
  try {
    // Index stays eager so search is always fresh.
    const workflowKey = currentHash !== null ? FILE_CHANGED_WORKFLOW : FILE_DELETED_WORKFLOW;
    const run = await mastra.getWorkflow(workflowKey).createRun();
    await run.start({ inputData: { filePath: relativePath } });
  } catch (error) {
    console.warn(`Vault watcher: failed to sync ${relativePath}:`, error);
  }

  // Record the external change as pending agent-work, accurately typed — the
  // hash diff lets the watcher tell created from modified, unlike the old
  // exists-only check.
  try {
    await enqueueChange({ path: relativePath, changeType: classification, source: "watcher" });
  } catch (error) {
    console.warn(`Vault watcher: failed to log change for ${relativePath}:`, error);
  }

  // Fold the change into the baseline so the duplicate events a single write
  // emits, and the next manual sync, agree it is now accounted for.
  try {
    await commitSelfWrite(VAULT_PATH, [relativePath]);
  } catch (error) {
    console.warn(`Vault watcher: failed to update baseline for ${relativePath}:`, error);
  }

  // Keep the semantic layer live: refresh summaries/graph for the changed files
  // once the burst settles. Debounced and isolated so it never crashes the host.
  scheduleSemanticSync();

  // A new drop into `_inbox` (and only there) is a candidate for auto-filing: if
  // the user opted in, plan it in the background once the burst settles and put
  // the plan up for approval.
  if (shouldScheduleAutoIntake(relativePath, autoIntakeEnabled())) scheduleAutoIntake(mastra);
}

/**
 * Auto-intake pass — planning only, never applying. Run the organizer subagent
 * headlessly to (re)build the intake plan for the current `_inbox`, then surface
 * it as a pending `intake` proposal. Nothing moves until the human approves it
 * in the desktop (工作区 proposal card), which applies the reviewed snapshot via
 * executeIntake and refreshes semantics for the touched paths (resolveProposal's
 * post-apply hook). Best-effort and fully isolated: a failure logs and leaves
 * `_inbox` untouched rather than crashing the watcher host.
 *
 * Single-flight with a trailing re-run: drops that arrive mid-pass schedule one
 * more pass when this one settles, so nothing is stranded in `_inbox`.
 */
async function runAutoIntake(mastra: Mastra): Promise<void> {
  if (autoIntakeRunning) {
    autoIntakePending = true;
    return;
  }
  autoIntakeRunning = true;
  try {
    // Planning only — the organizer never moves files; it records one decision
    // per entry into the durable intake plan.
    await mastra
      .getAgent("organizer")
      .generate("勘查 _inbox 并为每个条目产出迁移决策（recordDecision）。低置信度的留在 _inbox。", {
        maxSteps: 20,
      });
    // Consent gate: wrap the plan into an approvable proposal (superseding any
    // still-pending one) instead of executing it.
    const result = await proposeIntakePlan();
    if (result.proposalId) {
      console.log(
        `Vault watcher: auto-intake plan proposed (actionable=${result.actionable}, superseded=${result.superseded}, proposal=${result.proposalId})`,
      );
    }
  } catch (error) {
    console.warn("Vault watcher: auto-intake failed:", error);
  } finally {
    autoIntakeRunning = false;
    if (autoIntakePending) {
      autoIntakePending = false;
      scheduleAutoIntake(mastra);
    }
  }
}

function scheduleAutoIntake(mastra: Mastra): void {
  if (autoIntakeTimer) clearTimeout(autoIntakeTimer);
  autoIntakeTimer = setTimeout(() => {
    autoIntakeTimer = null;
    void runAutoIntake(mastra);
  }, AUTO_INTAKE_DEBOUNCE_MS);
}

async function runSemanticSync(): Promise<void> {
  // A refresh is already in flight — remember to run once more when it settles so
  // changes that landed mid-pass are picked up.
  if (semanticSyncRunning) {
    semanticSyncPending = true;
    return;
  }
  semanticSyncRunning = true;
  try {
    const report = await syncSemanticsFromChanges({ vaultPath: VAULT_PATH });
    if (report.refreshed || report.pruned) {
      console.log(
        `Vault watcher: semantic layer synced (refreshed=${report.refreshed}, pruned=${report.pruned})`,
      );
    }
  } catch (error) {
    console.warn("Vault watcher: semantic sync failed:", error);
  } finally {
    semanticSyncRunning = false;
    if (semanticSyncPending) {
      semanticSyncPending = false;
      scheduleSemanticSync();
    }
  }
}

function scheduleSemanticSync(): void {
  if (semanticSyncTimer) clearTimeout(semanticSyncTimer);
  semanticSyncTimer = setTimeout(() => {
    semanticSyncTimer = null;
    void runSemanticSync();
  }, SEMANTIC_SYNC_DEBOUNCE_MS);
}

export function startVaultWatcher(mastra: Mastra): void {
  if (watcher) return;
  try {
    watcher = watch(VAULT_PATH, { recursive: true }, (_eventType, filename) => {
      const relativePath = toPortablePath(filename ?? "");
      if (!relativePath || isIgnoredPath(relativePath)) return;
      if (!isMarkdownPath(relativePath)) return;
      void syncChange(mastra, relativePath);
    });
    console.log("Vault watcher started");
  } catch {
    console.warn("Vault watcher failed to start");
  }
}
