import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startScheduleTicker, reviewClockFor, type ReviewReminder } from "./scheduler.js";
import { JournalConfigSchema } from "../domain/charterConfig.js";
import { nullSearchIndex, setSearchIndex } from "../application/ports/searchIndex.js";
import { initOperationLedger, setOperationLedgerClient } from "../vault/operationLedger.js";
import type { PlanItem } from "../domain/journal.js";

const dirs: string[] = [];

afterEach(async () => {
  setOperationLedgerClient(null);
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(journal: Partial<Record<string, string>> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "apothecary-ticker-"));
  dirs.push(root);
  const vaultPath = path.join(root, "vault");
  await mkdir(vaultPath, { recursive: true });
  vi.stubEnv("APOTHECARY_HOME", path.join(root, "home"));
  setSearchIndex({ ...nullSearchIndex });
  await initOperationLedger(`file:${path.join(root, "operations.db")}`);

  const plans: PlanItem[] = [];
  const reviews: ReviewReminder[] = [];
  const digestCalls: string[] = [];
  const backfillCalls: string[] = [];
  let digestFailure: Error | null = null;
  let clock = new Date(2026, 6, 16, 9, 0); // 2026-07-16 周四 09:00
  const ticker = startScheduleTicker({
    vaultPath,
    notifyPlan: (item) => plans.push(item),
    notifyReview: (reminder) => reviews.push(reminder),
    onScheduleChanged: () => undefined,
    digests: {
      generate: async (cadence, key) => {
        if (digestFailure) throw digestFailure;
        digestCalls.push(`${cadence}:${key}`);
      },
      backfillDaily: async (key) => {
        backfillCalls.push(key);
      },
    },
    config: async () => JournalConfigSchema.parse(journal),
    now: () => clock,
  });
  ticker.stop(); // drive ticks manually
  const at = async (h: number, m: number, day = 16, month = 6): Promise<void> => {
    clock = new Date(2026, month, day, h, m);
    await ticker.tick();
  };
  const failDigests = (error: Error | null): void => { digestFailure = error; };
  return { vaultPath, plans, reviews, digestCalls, backfillCalls, failDigests, at };
}

describe("scheduler plan notifications", () => {
  it("instantiates today's daily note and fires items coming due", async () => {
    const { vaultPath, plans, at } = await setup();
    await at(9, 0); // first tick instantiates journal/daily/2026-07-16.md
    const relPath = "journal/daily/2026-07-16.md";
    const created = await readFile(path.join(vaultPath, relPath), "utf8");
    expect(created).toContain("## 计划");

    await writeFile(path.join(vaultPath, relPath), "## 计划\n- [ ] 09:05 站会\n", "utf8");
    await at(9, 5);
    expect(plans.map((p) => p.title)).toEqual(["站会"]);
    await at(9, 6); // fired set: no replay
    expect(plans).toHaveLength(1);
  });
});

describe("scheduler review reminders", () => {
  it("daily review fires at the configured clock when 复盘 is empty", async () => {
    const { reviews, at } = await setup({ daily_review: "21:30" });
    await at(21, 0);
    expect(reviews).toHaveLength(0);
    await at(21, 30);
    expect(reviews).toEqual([{ cadence: "daily", key: "2026-07-16", label: "今日复盘" }]);
    await at(21, 31); // dedup within the day
    expect(reviews).toHaveLength(1);
  });

  it("skips when the 复盘 section already has content", async () => {
    const { vaultPath, reviews, at } = await setup({ daily_review: "21:30" });
    await at(9, 0);
    const relPath = path.join(vaultPath, "journal/daily/2026-07-16.md");
    await writeFile(relPath, "## 计划\n\n## 复盘\n今天推进了日记功能。\n", "utf8");
    await at(21, 30);
    expect(reviews).toHaveLength(0);
  });

  it("weekly review fires only on the configured weekday and instantiates the week note", async () => {
    const { vaultPath, reviews, at } = await setup({ daily_review: "", weekly_review: "sun 21:00" });
    await at(21, 0, 16); // 周四 → 不响
    expect(reviews).toHaveLength(0);
    await at(21, 0, 19); // 2026-07-19 周日
    expect(reviews).toEqual([{ cadence: "weekly", key: "2026-W29", label: "本周复盘" }]);
    const week = await readFile(path.join(vaultPath, "journal/weekly/2026-W29.md"), "utf8");
    expect(week).toContain("start: 2026-07-13");
  });

  it("monthly fires on the month's last day; yearly on 12-31", async () => {
    const { reviews, at } = await setup({ daily_review: "", monthly_review: "21:00", yearly_review: "22:00" });
    await at(21, 0, 30); // 7月30日非最后一天
    expect(reviews).toHaveLength(0);
    await at(21, 0, 31);
    expect(reviews).toEqual([{ cadence: "monthly", key: "2026-07", label: "本月复盘" }]);
    await at(22, 0, 31, 11); // 12-31
    expect(reviews.at(-1)).toEqual({ cadence: "yearly", key: "2026", label: "年度复盘" });
  });

  it("stays silent past the grace window and when the spec is empty/malformed", async () => {
    const { reviews, at } = await setup({ daily_review: "21:30", weekly_review: "", monthly_review: "bogus" });
    await at(21, 0);
    await at(22, 30); // 一觉睡过 60 分钟 → 静默标记
    expect(reviews).toHaveLength(0);
    await at(23, 0, 31); // monthly 配置非法 → 关闭
    expect(reviews).toHaveLength(0);
  });
});

describe("reviewClockFor", () => {
  const thursday = new Date(2026, 6, 16);
  it("parses specs per cadence", () => {
    expect(reviewClockFor("daily", "9:05", thursday)).toBe("09:05");
    expect(reviewClockFor("weekly", "thu 21:00", thursday)).toBe("21:00");
    expect(reviewClockFor("weekly", "sun 21:00", thursday)).toBeNull();
    expect(reviewClockFor("monthly", "21:00", new Date(2026, 6, 31))).toBe("21:00");
    expect(reviewClockFor("monthly", "21:00", thursday)).toBeNull();
    expect(reviewClockFor("yearly", "21:00", new Date(2026, 11, 31))).toBe("21:00");
    expect(reviewClockFor("daily", "", thursday)).toBeNull();
    expect(reviewClockFor("daily", "25:00", thursday)).toBeNull();
    expect(reviewClockFor("weekly", "someday 21:00", thursday)).toBeNull();
  });
});

describe("scheduler digest hooks", () => {
  it("regenerates the digest at the review clock even when 复盘 is already written", async () => {
    const { vaultPath, reviews, digestCalls, at } = await setup({ daily_review: "21:30" });
    await at(9, 0);
    await writeFile(
      path.join(vaultPath, "journal/daily/2026-07-16.md"),
      "## 计划\n\n## 复盘\n写过了\n",
      "utf8",
    );
    await at(21, 30);
    expect(digestCalls).toEqual(["daily:2026-07-16"]);
    expect(reviews).toHaveLength(0); // reviewed → reminder skipped, digest not
    await at(21, 31); // fired set covers the digest too
    expect(digestCalls).toHaveLength(1);
  });

  it("still refreshes the digest silently when the clock was slept past", async () => {
    const { reviews, digestCalls, at } = await setup({ daily_review: "21:30" });
    await at(9, 0);
    await at(23, 0); // 90 min past due → no notification, fresh digest anyway
    expect(digestCalls).toEqual(["daily:2026-07-16"]);
    expect(reviews).toHaveLength(0);
  });

  it("a digest failure never blocks the review reminder", async () => {
    const { reviews, failDigests, at } = await setup({ daily_review: "21:30" });
    await at(9, 0);
    failDigests(new Error("llm down"));
    await at(21, 30);
    expect(reviews).toEqual([{ cadence: "daily", key: "2026-07-16", label: "今日复盘" }]);
  });

  it("backfills yesterday's daily digest on app start and on day rollover", async () => {
    const { backfillCalls, at } = await setup();
    await at(9, 0); // first tick of the session
    expect(backfillCalls).toEqual(["2026-07-15"]);
    await at(9, 1);
    expect(backfillCalls).toHaveLength(1); // same day: no re-probe
    await at(0, 5, 17); // day rolls over
    expect(backfillCalls).toEqual(["2026-07-15", "2026-07-16"]);
  });
});
