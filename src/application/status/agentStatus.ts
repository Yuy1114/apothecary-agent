import { apothecaryDb } from "../../config/apothecaryDb.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";
import { periodKeyFor, shiftPeriod } from "../../domain/journal.js";
import type { ProposalType } from "../../domain/proposal.js";
import { readPendingChangeCount, type ChangeQueueSnapshot } from "../../vault/changeQueueReader.js";
import { surveyInbox } from "../../vault/inboxSurvey.js";
import { loadProfileRefreshState, type ProfileRefreshState } from "../../vault/profileState.js";
import { listProposals } from "../../vault/proposalStore.js";
import { nowIso } from "../../utils/time.js";
import { readPeriod } from "../journal/journalStore.js";

/**
 * One read-only snapshot of everything waiting on the human, assembled from the
 * stores that already hold it. This is the agent-facing surface: an external
 * caller (the CLI, and through it Hermes) asks what needs attention without
 * having to know where any of it is persisted, and without the desktop app
 * needing to be running.
 *
 * Every source is best-effort — a status read that dies because one store is
 * missing is useless precisely when something is wrong.
 */

export type AttentionKind =
  | "proposals_pending"
  | "inbox_unfiled"
  | "changes_unprocessed"
  | "review_missing"
  | "profile_stale";

/** A machine-readable "something is waiting" item. Phrasing is the caller's job. */
export type AttentionItem = {
  kind: AttentionKind;
  /** How many things of this kind wait; 1 for the singular states. */
  count: number;
  /** Extra identifying context, e.g. the journal key whose review is missing. */
  detail?: string;
};

export type AgentStatus = {
  generatedAt: string;
  vaultPath: string;
  home: string;
  proposals: {
    pending: number;
    byType: Partial<Record<ProposalType, number>>;
    oldestPendingAt: string | null;
  };
  inbox: {
    /** Non-junk top-level entries still sitting in `_inbox`. */
    unfiled: number;
    junk: number;
    entries: { name: string; path: string; kind: string }[];
  };
  changes: ChangeQueueSnapshot;
  journal: {
    today: { key: string; exists: boolean; planItems: number; reviewFilled: boolean };
    yesterday: { key: string; exists: boolean; reviewFilled: boolean };
  };
  profile: { stale: boolean; lastRefreshAt?: string };
  attention: AttentionItem[];
};

export type CollectStatusOptions = {
  /** Fixed clock, for deterministic tests. */
  now?: Date;
  /** Override the change-queue database (tests point this at a temp file). */
  changeLogUrl?: string;
  /** Cap on inbox entries echoed back, so a 500-file drop cannot flood a message. */
  inboxEntryLimit?: number;
};

const EMPTY_INBOX = { unfiled: 0, junk: 0, entries: [] as AgentStatus["inbox"]["entries"] };

/** Derives the attention list from a collected status. Pure, so it is directly testable. */
export function deriveAttention(status: Omit<AgentStatus, "attention">): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (status.proposals.pending > 0) {
    items.push({ kind: "proposals_pending", count: status.proposals.pending });
  }
  if (status.inbox.unfiled > 0) {
    items.push({ kind: "inbox_unfiled", count: status.inbox.unfiled });
  }
  if (status.changes.pending && status.changes.pending > 0) {
    items.push({ kind: "changes_unprocessed", count: status.changes.pending });
  }
  // Yesterday is the one that can still be acted on; today's review is not late yet.
  if (status.journal.yesterday.exists && !status.journal.yesterday.reviewFilled) {
    items.push({ kind: "review_missing", count: 1, detail: status.journal.yesterday.key });
  }
  if (status.profile.stale) {
    items.push({ kind: "profile_stale", count: 1 });
  }
  return items;
}

export async function collectAgentStatus(
  vaultPath: string,
  options: CollectStatusOptions = {},
): Promise<AgentStatus> {
  const now = options.now ?? new Date();
  const home = apothecaryHome();
  const todayKey = periodKeyFor("daily", now);
  const yesterdayKey = shiftPeriod("daily", todayKey, -1);
  const entryLimit = options.inboxEntryLimit ?? 20;

  const [proposals, inbox, changes, today, yesterday, profile] = await Promise.all([
    listProposals(home, { status: "proposed" }).catch(() => []),
    surveyInbox(vaultPath).catch(() => null),
    readPendingChangeCount(options.changeLogUrl ?? apothecaryDb.changeLog()),
    readPeriod(vaultPath, "daily", todayKey).catch(() => null),
    readPeriod(vaultPath, "daily", yesterdayKey).catch(() => null),
    loadProfileRefreshState(home).catch((): ProfileRefreshState => ({ dirty: false })),
  ]);

  const byType: Partial<Record<ProposalType, number>> = {};
  for (const proposal of proposals) {
    byType[proposal.type] = (byType[proposal.type] ?? 0) + 1;
  }
  const oldestPendingAt = proposals.reduce<string | null>(
    (oldest, p) => (oldest === null || p.createdAt < oldest ? p.createdAt : oldest),
    null,
  );

  const core: Omit<AgentStatus, "attention"> = {
    generatedAt: nowIso(),
    vaultPath,
    home,
    proposals: { pending: proposals.length, byType, oldestPendingAt },
    inbox: inbox
      ? {
          unfiled: inbox.entries.length,
          junk: inbox.junk,
          entries: inbox.entries
            .slice(0, entryLimit)
            .map((e) => ({ name: e.name, path: e.path, kind: e.kind })),
        }
      : EMPTY_INBOX,
    changes,
    journal: {
      today: {
        key: todayKey,
        exists: today?.exists ?? false,
        planItems: today?.items.length ?? 0,
        reviewFilled: today?.reviewFilled ?? false,
      },
      yesterday: {
        key: yesterdayKey,
        exists: yesterday?.exists ?? false,
        reviewFilled: yesterday?.reviewFilled ?? false,
      },
    },
    profile: { stale: profile.dirty, lastRefreshAt: profile.lastRefreshAt },
  };

  return { ...core, attention: deriveAttention(core) };
}
