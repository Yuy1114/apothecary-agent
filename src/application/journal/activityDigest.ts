import { promises as fs } from "node:fs";
import { safeVaultPath } from "../../safety/pathSafety.js";
import { listRecentChanges } from "../../vault/changeLog.js";
import { listOperations, recordOperation, type OperationRecord, type OperationType } from "../../vault/operationLedger.js";
import { listProposals } from "../../vault/proposalStore.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";
import { nowIso } from "../../utils/time.js";
import {
  CADENCE_KEY_PATTERNS,
  DIGEST_DIR,
  digestRelPath,
  digestTitle,
  emptyDigestFacts,
  digestFactCount,
  periodRange,
  renderDigest,
  renderDigestFacts,
  type Cadence,
  type DigestFacts,
} from "../../domain/journal.js";
import { writeCommitted } from "./journalStore.js";
import type { DigestWriter } from "../ports/digestWriter.js";

/** Skips the LLM call outright — an empty period needs no narrative. */
export const DIGEST_SUMMARY_QUIET = "本期没有记录到任何活动。";

// Operations whose ledger entry stores [from, ..., to] (same convention as
// recentActivity's timeline mapping).
const RELOCATING_OPS = new Set<OperationType>(["move", "archive", "merge"]);

const resolveDigestPath = (vaultPath: string, cadence: Cadence, key: string): { relPath: string; abs: string } => {
  if (!CADENCE_KEY_PATTERNS[cadence].test(key)) throw new Error(`invalid_journal_key: ${cadence}/${key}`);
  const relPath = digestRelPath(cadence, key);
  const abs = safeVaultPath(vaultPath, relPath);
  if (!abs) throw new Error(`unsafe_journal_path: ${relPath}`);
  return { relPath, abs };
};

/** Local-midnight ISO window [since, until) covering the period's calendar days. */
function periodWindow(cadence: Cadence, key: string): { since: string; until: string } {
  const { start, end } = periodRange(cadence, key);
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  return {
    since: new Date(sy, sm - 1, sd).toISOString(),
    until: new Date(ey, em - 1, ed + 1).toISOString(),
  };
}

const isDigestPath = (p: string): boolean => p.startsWith(`${DIGEST_DIR}/`);

function operationEntry(op: OperationRecord): DigestFacts["agentOperations"][number] {
  const relocated = RELOCATING_OPS.has(op.type) && op.targetFiles.length >= 2;
  return {
    type: op.type,
    path: (relocated ? op.targetFiles.at(-1) : op.targetFiles[0]) ?? "",
    fromPath: relocated ? op.targetFiles[0] : undefined,
    detail: op.rationale || undefined,
  };
}

/** Collect one period's DigestFacts from both ledgers and the proposal store. */
export async function collectDigestFacts(cadence: Cadence, key: string): Promise<DigestFacts> {
  const { since, until } = periodWindow(cadence, key);
  const facts = emptyDigestFacts();

  const changes = await listRecentChanges({ since, limit: 500 });
  facts.userChanges = changes
    .filter((c) => c.detectedAt < until && !isDigestPath(c.path))
    .map((c) => ({ kind: c.changeType, path: c.path }));

  const operations = await listOperations({ since, limit: 500 });
  facts.agentOperations = operations
    // The digest's own writes must not appear in the next digest.
    .filter((op) => op.appliedAt < until && op.source !== "digest" && !op.targetFiles.every(isDigestPath))
    .map(operationEntry);

  const proposals = await listProposals(apothecaryHome());
  facts.proposals = proposals
    .filter((p) => p.resolvedAt && p.resolvedAt >= since && p.resolvedAt < until)
    .filter((p) => p.status === "applied" || p.status === "rejected")
    .map((p) => ({ title: p.title, outcome: p.status as "applied" | "rejected" }));

  // Both ledgers return newest-first; the digest reads better oldest-first.
  facts.userChanges.reverse();
  facts.agentOperations.reverse();
  facts.proposals.reverse();
  return facts;
}

export type GenerateDigestResult = {
  relPath: string;
  content: string;
  /** True when the narrative fell back (LLM failure) — facts still landed. */
  degraded: boolean;
};

/**
 * (Re)generates one period's activity digest under `journal/digests/` — the
 * machine-owned namespace: agent-written derived data, no proposal gate, humans
 * read but do not edit. The `## 明细` facts always land even when the summary
 * LLM call fails (graceful degradation, same lesson as the embedding outage).
 */
export async function generateDigest(
  input: { vaultPath: string; cadence: Cadence; key: string },
  writer: DigestWriter,
): Promise<GenerateDigestResult> {
  const { relPath, abs } = resolveDigestPath(input.vaultPath, input.cadence, input.key);
  const facts = await collectDigestFacts(input.cadence, input.key);

  let summary = DIGEST_SUMMARY_QUIET;
  let degraded = false;
  if (digestFactCount(facts) > 0) {
    try {
      summary = await writer.summarize({
        periodTitle: digestTitle(input.key),
        factsMarkdown: renderDigestFacts(facts),
      });
    } catch {
      summary = ""; // renderDigest substitutes the fallback placeholder
      degraded = true;
    }
  }

  const content = renderDigest(input.cadence, input.key, facts, summary, nowIso());
  await writeCommitted(input.vaultPath, relPath, abs, content);
  await recordOperation({
    type: "capture",
    targetFiles: [relPath],
    rationale: `生成 ${input.key} 活动摘要`,
    source: "digest",
  });
  return { relPath, content, degraded };
}

/**
 * The day-rollover / app-start backfill: yesterday's digest is generated only
 * when it is missing AND the day actually saw activity — so a fresh install
 * (or an eventless day) never grows placeholder files, and a normal launch
 * costs one fs probe, not an LLM call.
 */
export async function backfillDailyDigest(
  input: { vaultPath: string; key: string },
  writer: DigestWriter,
): Promise<{ generated: boolean }> {
  if (await digestExists(input.vaultPath, "daily", input.key)) return { generated: false };
  const facts = await collectDigestFacts("daily", input.key);
  if (digestFactCount(facts) === 0) return { generated: false };
  await generateDigest({ vaultPath: input.vaultPath, cadence: "daily", key: input.key }, writer);
  return { generated: true };
}

/** Cheap existence probe for the scheduler's "backfill yesterday" branch. */
export async function digestExists(vaultPath: string, cadence: Cadence, key: string): Promise<boolean> {
  try {
    const { abs } = resolveDigestPath(vaultPath, cadence, key);
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}
