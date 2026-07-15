import { instantiateDay, readDaySchedule } from "../application/schedule/scheduleStore.js";
import {
  dueItems,
  formatLocalDate,
  formatLocalMinute,
  itemKey,
  minutesBetween,
  scheduleSummary,
  type ScheduleItem,
} from "../domain/schedule.js";
import { logger } from "../observability/logger.js";

export type SchedulerDeps = {
  vaultPath: string;
  /** Fire an OS notification for an item whose start time just arrived. */
  notify: (item: ScheduleItem) => void;
  /** Tray badge refresh, called once per tick with the day's summary. */
  onScheduleChanged: (summary: { total: number; remaining: number }) => void;
  /** Test seam. */
  now?: () => Date;
};

// Items further past due than this on a tick are marked fired silently — a
// laptop waking from hours of sleep must not replay the whole backlog.
const NOTIFY_GRACE_MINUTES = 10;

/**
 * The minute ticker behind the 日程 tray: keeps today's note instantiated,
 * fires notifications for items coming due, and feeds the tray badge. All
 * state (fired set, day, last minute) is in-memory — a restart re-arms only
 * the current minute, by design.
 */
export function startScheduleTicker(deps: SchedulerDeps): { tick: () => Promise<void>; stop: () => void } {
  const now = deps.now ?? (() => new Date());
  let currentDay: string | null = null;
  let lastMinute: string | null = null;
  const fired = new Set<string>();

  const tick = async (): Promise<void> => {
    try {
      const day = formatLocalDate(now());
      const minute = formatLocalMinute(now());
      if (day !== currentDay) {
        currentDay = day;
        lastMinute = null;
        fired.clear();
      }
      await instantiateDay(deps.vaultPath, day).catch((error) => {
        logger.warn("schedule", `今日日程生成失败: ${(error as Error).message}`);
      });
      const { items } = await readDaySchedule(deps.vaultPath, day);
      for (const item of dueItems(items, { since: lastMinute, now: minute })) {
        const key = itemKey(item);
        if (fired.has(key)) continue;
        fired.add(key);
        // Slept past it by more than the grace window → stay silent; the tray
        // remaining count still surfaces it.
        if (minutesBetween(item.time!, minute) <= NOTIFY_GRACE_MINUTES) deps.notify(item);
      }
      lastMinute = minute;
      deps.onScheduleChanged(scheduleSummary(items));
    } catch (error) {
      logger.warn("schedule", `tick 失败: ${(error as Error).message}`);
    }
  };

  const interval = setInterval(() => void tick(), 60_000);
  return {
    tick,
    stop: () => clearInterval(interval),
  };
}
