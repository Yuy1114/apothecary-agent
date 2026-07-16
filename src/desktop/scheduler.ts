import { instantiatePeriod, readPeriod } from "../application/journal/journalStore.js";
import { loadCharterConfig } from "../config/charterConfig.js";
import { getAgentArtifacts } from "../artifacts/agentArtifacts.js";
import { apothecaryHome } from "../config/apothecaryHome.js";
import { JournalConfigSchema, type JournalConfig } from "../domain/charterConfig.js";
import {
  dueItems,
  formatLocalDate,
  formatLocalMinute,
  itemKey,
  minutesBetween,
  periodKeyFor,
  planSummary,
  type Cadence,
  type PlanItem,
} from "../domain/journal.js";
import { logger } from "../observability/logger.js";

export type ReviewReminder = { cadence: Cadence; key: string; label: string };

export type SchedulerDeps = {
  vaultPath: string;
  /** Fire an OS notification for a plan item whose start time just arrived. */
  notifyPlan: (item: PlanItem) => void;
  /** Fire an OS notification nudging the pending review of a period. */
  notifyReview: (reminder: ReviewReminder) => void;
  /** Tray badge refresh, called once per tick with the day's plan summary. */
  onScheduleChanged: (summary: { total: number; remaining: number }) => void;
  /** Config source (test seam); defaults to ~/.apothecary/config.yaml `journal:`. */
  config?: () => Promise<JournalConfig>;
  /** Test seam. */
  now?: () => Date;
};

// Items further past due than this on a tick are marked fired silently — a
// laptop waking from hours of sleep must not replay the whole backlog.
const NOTIFY_GRACE_MINUTES = 10;

export const REVIEW_LABELS: Record<Cadence, string> = {
  daily: "今日复盘",
  weekly: "本周复盘",
  monthly: "本月复盘",
  yearly: "年度复盘",
};

const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const CLOCK = /^(\d{1,2}):(\d{2})$/;

const normalizeClock = (raw: string): string | null => {
  const match = CLOCK.exec(raw.trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
};

/**
 * Parse one cadence's reminder spec into "fires today at <clock>?" terms.
 * daily/monthly/yearly take "HH:MM"; weekly takes "<mon..sun> HH:MM". Empty or
 * malformed specs disable the cadence (a config.yaml typo must not throw).
 */
export function reviewClockFor(cadence: Cadence, spec: string, day: Date): string | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  if (cadence === "weekly") {
    const [weekday, clock] = trimmed.split(/\s+/);
    if (WEEKDAYS[weekday?.toLowerCase()] === undefined || !clock) return null;
    return day.getDay() === WEEKDAYS[weekday.toLowerCase()] ? normalizeClock(clock) : null;
  }
  const clock = normalizeClock(trimmed);
  if (clock === null) return null;
  if (cadence === "monthly") {
    const lastDay = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
    return day.getDate() === lastDay ? clock : null;
  }
  if (cadence === "yearly") return day.getMonth() === 11 && day.getDate() === 31 ? clock : null;
  return clock; // daily
}

/** Same (since, now] window semantics as plan items; first tick = exact minute. */
const clockDue = (clock: string, since: string | null, now: string): boolean =>
  since === null ? clock === now : clock > since && clock <= now;

async function defaultConfig(): Promise<JournalConfig> {
  try {
    return (await loadCharterConfig(getAgentArtifacts(apothecaryHome()))).journal;
  } catch {
    return JournalConfigSchema.parse({});
  }
}

/**
 * The minute ticker behind the 日记 tray: keeps today's note instantiated,
 * fires notifications for plan items coming due and for pending period
 * reviews, and feeds the tray badge. All state (fired set, day, last minute)
 * is in-memory — a restart re-arms only the current minute, by design.
 */
export function startScheduleTicker(deps: SchedulerDeps): { tick: () => Promise<void>; stop: () => void } {
  const now = deps.now ?? (() => new Date());
  const config = deps.config ?? defaultConfig;
  let currentDay: string | null = null;
  let lastMinute: string | null = null;
  const fired = new Set<string>();

  const reviewSpec = (journal: JournalConfig): Record<Cadence, string> => ({
    daily: journal.daily_review,
    weekly: journal.weekly_review,
    monthly: journal.monthly_review,
    yearly: journal.yearly_review,
  });

  const tickReviews = async (minute: string, since: string | null): Promise<void> => {
    const specs = reviewSpec(await config());
    for (const cadence of Object.keys(specs) as Cadence[]) {
      const clock = reviewClockFor(cadence, specs[cadence], now());
      if (clock === null || !clockDue(clock, since, minute)) continue;
      const key = periodKeyFor(cadence, now());
      const firedKey = `review:${cadence}:${key}`;
      if (fired.has(firedKey)) continue;
      fired.add(firedKey);
      if (minutesBetween(clock, minute) > NOTIFY_GRACE_MINUTES) continue; // slept past it
      // The review lives in the period's note — make sure it exists so the
      // notification lands the user on a ready page, then skip when already
      // written (the linkage: the note's 复盘 section is the reminder's state).
      const { note } = await instantiatePeriod(deps.vaultPath, cadence, key);
      if (note.reviewFilled) continue;
      deps.notifyReview({ cadence, key, label: REVIEW_LABELS[cadence] });
    }
  };

  const tick = async (): Promise<void> => {
    try {
      const day = formatLocalDate(now());
      const minute = formatLocalMinute(now());
      if (day !== currentDay) {
        currentDay = day;
        lastMinute = null;
        fired.clear();
      }
      await instantiatePeriod(deps.vaultPath, "daily", day).catch((error) => {
        logger.warn("journal", `今日日记生成失败: ${(error as Error).message}`);
      });
      const { items } = await readPeriod(deps.vaultPath, "daily", day);
      for (const item of dueItems(items, { since: lastMinute, now: minute })) {
        const key = itemKey(item);
        if (fired.has(key)) continue;
        fired.add(key);
        // Slept past it by more than the grace window → stay silent; the tray
        // remaining count still surfaces it.
        if (minutesBetween(item.time!, minute) <= NOTIFY_GRACE_MINUTES) deps.notifyPlan(item);
      }
      await tickReviews(minute, lastMinute).catch((error) => {
        logger.warn("journal", `复盘提醒失败: ${(error as Error).message}`);
      });
      lastMinute = minute;
      deps.onScheduleChanged(planSummary(items));
    } catch (error) {
      logger.warn("journal", `tick 失败: ${(error as Error).message}`);
    }
  };

  const interval = setInterval(() => void tick(), 60_000);
  return {
    tick,
    stop: () => clearInterval(interval),
  };
}
