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
import { snapshotExternalChanges } from "../../application/versioning/vaultSnapshots.js";
import { proposeIntakePlan } from "../../application/intake/proposeIntake.js";
import { manualSync, type ManualSyncReport } from "../../application/sync/manualSync.js";
import { surveyInbox } from "../../vault/inboxSurvey.js";
import type { AutoIntakeStatus } from "../../domain/autoIntakeStatus.js";
import { nowIso } from "../../utils/time.js";

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

// The observable phase of the auto-intake pass, surfaced to the desktop so the
// user can see what the agent is doing during the trigger→proposal window. This
// module is the single source of truth; the desktop reads it via an injected
// dep (the application layer must not import mastra).
let autoIntakeStatus: AutoIntakeStatus = { phase: "idle", since: nowIso() };

function setAutoIntakePhase(patch: Partial<AutoIntakeStatus> & Pick<AutoIntakeStatus, "phase">): void {
  autoIntakeStatus = { ...autoIntakeStatus, ...patch, since: nowIso() };
}

/** Live auto-intake phase for the desktop sidebar/settings status. */
export function getAutoIntakeStatus(): AutoIntakeStatus {
  return autoIntakeStatus;
}
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let snapshotPaths = new Set<string>();
let snapshotBatchStart: string | null = null;

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

/**
 * The startup catch-up should plan an intake pass iff auto-intake is opted in
 * and `_inbox` currently holds at least one (non-junk) item — offline drops the
 * live watcher never saw an event for. Pure so the boot trigger is unit-tested.
 */
export function shouldCatchUpAutoIntake(inboxEntryCount: number, enabled: boolean): boolean {
  return enabled && inboxEntryCount > 0;
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
    // Version the edit once the burst settles: one commit per batch, sha
    // stamped back onto the rows just enqueued.
    scheduleManualSnapshot(relativePath);
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
  if (shouldScheduleAutoIntake(relativePath, autoIntakeEnabled())) scheduleAutoIntake(mastra, "drop");
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
type AutoIntakeDeps = {
  /** Run the organizer headlessly to (re)build the durable intake plan. */
  plan: (mastra: Mastra) => Promise<void>;
  /** Wrap the current plan into an approvable proposal (the consent gate). */
  propose: () => Promise<{ proposalId?: string; actionable: number; superseded: number }>;
};

const defaultAutoIntakeDeps: AutoIntakeDeps = {
  // Planning only — the organizer never moves files; it records one decision
  // per entry into the durable intake plan.
  plan: async (mastra) => {
    await mastra
      .getAgent("organizer")
      .generate("勘查 _inbox 并为每个条目产出迁移决策（recordDecision）。低置信度的留在 _inbox。", {
        maxSteps: 20,
      });
  },
  propose: proposeIntakePlan,
};

export async function runAutoIntake(
  mastra: Mastra,
  deps: AutoIntakeDeps = defaultAutoIntakeDeps,
): Promise<void> {
  if (autoIntakeRunning) {
    autoIntakePending = true;
    return;
  }
  autoIntakeRunning = true;
  setAutoIntakePhase({ phase: "planning" });
  try {
    await deps.plan(mastra);
    // Consent gate: wrap the plan into an approvable proposal (superseding any
    // still-pending one) instead of executing it.
    const result = await deps.propose();
    if (result.proposalId) {
      setAutoIntakePhase({ phase: "proposed", lastProposalId: result.proposalId, actionable: result.actionable });
      console.log(
        `Vault watcher: auto-intake plan proposed (actionable=${result.actionable}, superseded=${result.superseded}, proposal=${result.proposalId})`,
      );
    } else {
      // Nothing actionable in `_inbox` — back to idle rather than a stale phase.
      setAutoIntakePhase({ phase: "idle" });
    }
  } catch (error) {
    setAutoIntakePhase({ phase: "failed", lastError: error instanceof Error ? error.message : String(error) });
    console.warn("Vault watcher: auto-intake failed:", error);
  } finally {
    autoIntakeRunning = false;
    if (autoIntakePending) {
      autoIntakePending = false;
      scheduleAutoIntake(mastra);
    }
  }
}

function scheduleAutoIntake(
  mastra: Mastra,
  trigger: AutoIntakeStatus["trigger"] = autoIntakeStatus.trigger,
): void {
  // Reflect "a pass is queued" — unless one is already planning, in which case
  // this is a trailing re-run and the user should keep seeing "planning".
  if (!autoIntakeRunning) setAutoIntakePhase({ phase: "scheduled", trigger });
  if (autoIntakeTimer) clearTimeout(autoIntakeTimer);
  autoIntakeTimer = setTimeout(() => {
    autoIntakeTimer = null;
    void runAutoIntake(mastra);
  }, AUTO_INTAKE_DEBOUNCE_MS);
}

// Batch external edits into one snapshot commit per settled burst. The batch
// start is remembered (with a minute of slack) so the sha only stamps rows
// enqueued by this batch, never older unsnapshotted history for the same path.
function scheduleManualSnapshot(relativePath: string): void {
  if (!snapshotBatchStart) snapshotBatchStart = new Date(Date.now() - 60_000).toISOString();
  snapshotPaths.add(relativePath);
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    const paths = [...snapshotPaths];
    const since = snapshotBatchStart ?? new Date(Date.now() - 60_000).toISOString();
    snapshotPaths = new Set();
    snapshotBatchStart = null;
    void snapshotExternalChanges(VAULT_PATH, paths, since).catch((error) => {
      console.warn("Vault watcher: snapshot of external edits failed:", error);
    });
  }, SEMANTIC_SYNC_DEBOUNCE_MS);
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

type CatchUpDeps = {
  sync: (input: { vaultPath: string }) => Promise<ManualSyncReport>;
  survey: (vaultPath: string) => Promise<{ entries: unknown[] }>;
  schedule: (mastra: Mastra) => void;
};

const defaultCatchUpDeps: CatchUpDeps = {
  sync: manualSync,
  survey: surveyInbox,
  schedule: (mastra) => scheduleAutoIntake(mastra, "startup"),
};

/**
 * Boot-time catch-up sweep. The live watcher below only observes events from the
 * moment it starts, so anything that changed in the vault — or was dropped into
 * `_inbox` — while the app was closed is invisible to it. On startup we run one
 * manual sync to recover those offline edits into the index / change ledger /
 * snapshot / semantic layers, then, if auto-intake is opted in and `_inbox`
 * holds anything, plan an intake pass so offline drops get filed just like live
 * ones. Fully isolated and best-effort — each half fails independently and only
 * logs, so a boot-time hiccup never takes down the watcher host.
 */
export async function runStartupCatchUp(
  mastra: Mastra,
  deps: CatchUpDeps = defaultCatchUpDeps,
): Promise<void> {
  try {
    const report = await deps.sync({ vaultPath: VAULT_PATH });
    if (report.created || report.modified || report.deleted) {
      console.log(
        `Vault watcher: startup catch-up recovered offline changes (created=${report.created}, modified=${report.modified}, deleted=${report.deleted})`,
      );
    }
  } catch (error) {
    console.warn("Vault watcher: startup catch-up sync failed:", error);
  }

  // Offline `_inbox` drops fired no watcher event, so they were never scheduled.
  // Survey the folder and, if opted in and non-empty, plan one intake pass — the
  // same planning-only path a live drop takes (still gated on human approval).
  if (!autoIntakeEnabled()) return;
  try {
    const survey = await deps.survey(VAULT_PATH);
    if (shouldCatchUpAutoIntake(survey.entries.length, autoIntakeEnabled())) {
      console.log(
        `Vault watcher: startup found ${survey.entries.length} _inbox item(s) — scheduling auto-intake`,
      );
      deps.schedule(mastra);
    }
  } catch (error) {
    console.warn("Vault watcher: startup inbox survey failed:", error);
  }
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
  // Recover anything that changed while the app was closed — the live watcher
  // above only sees events from here on. Deferred (not awaited) so the
  // full-vault scan never blocks boot.
  if (watcher) void runStartupCatchUp(mastra);
}
