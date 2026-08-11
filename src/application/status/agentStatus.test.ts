import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectAgentStatus, deriveAttention, type AgentStatus } from "./agentStatus.js";
import { initChangeLog, enqueueChange, setChangeLogClient } from "../../vault/changeLog.js";
import { createProposal } from "../../vault/proposalStore.js";
import { markProfileDirty } from "../../vault/profileState.js";

const dirs: string[] = [];
const originalHome = process.env.APOTHECARY_HOME;

afterEach(async () => {
  setChangeLogClient(null);
  process.env.APOTHECARY_HOME = originalHome;
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** A vault + an isolated agent home, wired the way the CLI would find them. */
async function freshWorkspace(): Promise<{ vault: string; home: string }> {
  const vault = await mkdtemp(path.join(tmpdir(), "apothecary-status-vault-"));
  const home = await mkdtemp(path.join(tmpdir(), "apothecary-status-home-"));
  dirs.push(vault, home);
  await mkdir(path.join(vault, "_inbox"), { recursive: true });
  await mkdir(path.join(vault, "journal", "daily"), { recursive: true });
  process.env.APOTHECARY_HOME = home;
  return { vault, home };
}

const journal = (vault: string, key: string, body: string) =>
  writeFile(path.join(vault, "journal", "daily", `${key}.md`), body, "utf8");

const NOW = new Date("2026-08-01T09:00:00+08:00");
const TODAY = "2026-08-01";
const YESTERDAY = "2026-07-31";

describe("collectAgentStatus", () => {
  it("reports an all-clear vault with nothing waiting", async () => {
    const { vault } = await freshWorkspace();

    const status = await collectAgentStatus(vault, {
      now: NOW,
      changeLogUrl: `file:${path.join(vault, "missing-queue.db")}`,
    });

    expect(status.vaultPath).toBe(vault);
    expect(status.proposals.pending).toBe(0);
    expect(status.inbox.unfiled).toBe(0);
    // A queue that was never created is empty, not broken.
    expect(status.changes).toMatchObject({ pending: 0, degraded: false });
    expect(status.journal.today.key).toBe(TODAY);
    expect(status.journal.yesterday.key).toBe(YESTERDAY);
    expect(status.attention).toEqual([]);
  });

  it("counts pending proposals by type and keeps the oldest timestamp", async () => {
    const { vault, home } = await freshWorkspace();
    await createProposal(home, {
      type: "move",
      title: "归位 A",
      rationale: "r",
      payload: { from: "_inbox/a.md", to: "notes/a.md" },
    });
    await createProposal(home, {
      type: "move",
      title: "归位 B",
      rationale: "r",
      payload: { from: "_inbox/b.md", to: "notes/b.md" },
    });
    await createProposal(home, {
      type: "capture",
      title: "记一笔",
      rationale: "r",
      payload: { content: "内容" },
    });

    const status = await collectAgentStatus(vault, {
      now: NOW,
      changeLogUrl: `file:${path.join(vault, "missing-queue.db")}`,
    });

    expect(status.proposals.pending).toBe(3);
    expect(status.proposals.byType).toEqual({ move: 2, capture: 1 });
    expect(status.proposals.oldestPendingAt).not.toBeNull();
    expect(status.attention).toContainEqual({ kind: "proposals_pending", count: 3 });
  });

  it("surfaces unfiled inbox entries but not junk", async () => {
    const { vault } = await freshWorkspace();
    await writeFile(path.join(vault, "_inbox", "prompt 编写规范.md"), "# x", "utf8");
    await writeFile(path.join(vault, "_inbox", "读书笔记.pdf"), "x", "utf8");
    await writeFile(path.join(vault, "_inbox", ".DS_Store"), "x", "utf8");

    const status = await collectAgentStatus(vault, {
      now: NOW,
      changeLogUrl: `file:${path.join(vault, "missing-queue.db")}`,
    });

    expect(status.inbox.unfiled).toBe(2);
    expect(status.inbox.junk).toBe(1);
    expect(status.inbox.entries.map((e) => e.name).sort()).toEqual(["prompt 编写规范.md", "读书笔记.pdf"]);
    expect(status.attention).toContainEqual({ kind: "inbox_unfiled", count: 2 });
  });

  it("reads the pending-change queue without holding a write lock", async () => {
    const { vault } = await freshWorkspace();
    const changeLogUrl = `file:${path.join(vault, "queue.db")}`;
    await initChangeLog(changeLogUrl);
    await enqueueChange({ path: "notes/a.md", changeType: "modified", source: "watcher" });
    await enqueueChange({ path: "notes/b.md", changeType: "created", source: "watcher" });

    const status = await collectAgentStatus(vault, { now: NOW, changeLogUrl });

    expect(status.changes).toMatchObject({ pending: 2, degraded: false });
    expect(status.attention).toContainEqual({ kind: "changes_unprocessed", count: 2 });
  });

  it("flags yesterday's missing review, and stays quiet once it is written", async () => {
    const { vault } = await freshWorkspace();
    await journal(vault, YESTERDAY, "# 2026-07-31\n\n## 计划\n\n## 日志\n\n## 复盘\n\n");
    const missing = await collectAgentStatus(vault, {
      now: NOW,
      changeLogUrl: `file:${path.join(vault, "missing-queue.db")}`,
    });
    expect(missing.attention).toContainEqual({
      kind: "review_missing",
      count: 1,
      detail: YESTERDAY,
    });

    await journal(vault, YESTERDAY, "# 2026-07-31\n\n## 计划\n\n## 日志\n\n## 复盘\n\n今天读完了 X。\n");
    const filled = await collectAgentStatus(vault, {
      now: NOW,
      changeLogUrl: `file:${path.join(vault, "missing-queue.db")}`,
    });
    expect(filled.journal.yesterday.reviewFilled).toBe(true);
    expect(filled.attention).toEqual([]);
  });

  it("counts today's plan items and never nags about today's review", async () => {
    const { vault } = await freshWorkspace();
    await journal(vault, TODAY, "# 2026-08-01\n\n## 计划\n\n- [ ] 09:30 站会\n- [ ] 写周报\n\n## 复盘\n\n");

    const status = await collectAgentStatus(vault, {
      now: NOW,
      changeLogUrl: `file:${path.join(vault, "missing-queue.db")}`,
    });

    expect(status.journal.today.planItems).toBe(2);
    expect(status.attention.map((a) => a.kind)).not.toContain("review_missing");
  });

  it("reports a stale knowledge profile", async () => {
    const { vault, home } = await freshWorkspace();
    await markProfileDirty(home);

    const status = await collectAgentStatus(vault, {
      now: NOW,
      changeLogUrl: `file:${path.join(vault, "missing-queue.db")}`,
    });

    expect(status.profile.stale).toBe(true);
    expect(status.attention).toContainEqual({ kind: "profile_stale", count: 1 });
  });

  it("degrades instead of throwing when a source is unreadable", async () => {
    const { vault } = await freshWorkspace();
    await rm(path.join(vault, "_inbox"), { recursive: true, force: true });

    const status = await collectAgentStatus(vault, {
      now: NOW,
      // A directory is not a database: forces the queue read to fail outright.
      changeLogUrl: `file:${vault}`,
    });

    expect(status.inbox.unfiled).toBe(0);
    expect(status.changes.degraded).toBe(true);
    expect(status.changes.pending).toBeNull();
    // A queue we cannot read must not be reported as work waiting.
    expect(status.attention.map((a) => a.kind)).not.toContain("changes_unprocessed");
  });
});

describe("deriveAttention", () => {
  const base: Omit<AgentStatus, "attention"> = {
    generatedAt: "2026-08-01T01:00:00.000Z",
    vaultPath: "/v",
    home: "/h",
    proposals: { pending: 0, byType: {}, oldestPendingAt: null },
    inbox: { unfiled: 0, junk: 0, entries: [] },
    changes: { pending: 0, degraded: false },
    journal: {
      today: { key: TODAY, exists: true, planItems: 0, reviewFilled: false },
      yesterday: { key: YESTERDAY, exists: true, reviewFilled: true },
    },
    profile: { stale: false },
  };

  it("returns nothing when the vault is settled", () => {
    expect(deriveAttention(base)).toEqual([]);
  });

  it("does not ask for a review on a day that has no journal note", () => {
    const items = deriveAttention({
      ...base,
      journal: { ...base.journal, yesterday: { key: YESTERDAY, exists: false, reviewFilled: false } },
    });
    expect(items).toEqual([]);
  });

  it("orders items so approvals come before background hygiene", () => {
    const items = deriveAttention({
      ...base,
      proposals: { pending: 2, byType: { move: 2 }, oldestPendingAt: "2026-07-30T00:00:00.000Z" },
      inbox: { unfiled: 4, junk: 0, entries: [] },
      profile: { stale: true },
    });
    expect(items.map((i) => i.kind)).toEqual(["proposals_pending", "inbox_unfiled", "profile_stale"]);
  });
});
