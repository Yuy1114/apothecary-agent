import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DailyScheduleSchema,
  renderScheduleMarkdown,
  parseScheduleMarkdown,
  scheduleRelPath,
  type DailySchedule,
} from "../../domain/schedule.js";

/**
 * Durable store for daily schedules, stored as self-contained markdown notes
 * under `<vault>/schedule/`. The agent writes, Yuy reads — no proposal gate
 * because schedules are derived output (like activity digests), not knowledge.
 */

function resolvePath(vaultPath: string, date: string): string {
  return path.join(vaultPath, scheduleRelPath(date));
}

/** Load a schedule for a given date. Returns null when it doesn't exist. */
export async function loadSchedule(
  vaultPath: string,
  date: string,
): Promise<DailySchedule | null> {
  try {
    const raw = await fs.readFile(resolvePath(vaultPath, date), "utf8");
    return parseScheduleMarkdown(raw);
  } catch {
    return null;
  }
}

/** Save (create or overwrite) a daily schedule. */
export async function saveSchedule(
  vaultPath: string,
  schedule: DailySchedule,
): Promise<void> {
  const filePath = resolvePath(vaultPath, schedule.date);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const md = renderScheduleMarkdown(schedule);
  // Atomic write to prevent half-written files.
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, md, "utf8");
  await fs.rename(tmp, filePath);
}

/** List the 7 most recent schedule dates (newest first). */
export async function listRecentScheduleDates(
  vaultPath: string,
): Promise<string[]> {
  const dir = path.join(vaultPath, "schedule");
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((e) => e.endsWith(".md"))
      .map((e) => e.replace(/\.md$/, ""))
      .sort()
      .reverse()
      .slice(0, 7);
  } catch {
    return [];
  }
}
