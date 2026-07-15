// Daily schedule (日程) domain: parsing and transforming the checklist lines of
// a day note. The vault note is the source of truth — everything here is a pure
// projection of its text, so the desktop tray, the ticker, and tests all agree.

export const SCHEDULE_DIR = "areas/schedule";
export const TEMPLATE_REL_PATH = `${SCHEDULE_DIR}/_template.md`;

export type ScheduleItem = {
  /** 1-based line number in the note (matches MarkdownHeading.line convention). */
  line: number;
  /** Normalized "HH:MM" start time, when the title began with a clock time. */
  time?: string;
  /** Normalized "HH:MM" end time, when a range like 10:00-12:00 was given. */
  endTime?: string;
  title: string;
  done: boolean;
  /** The exact original line, for stale-menu detection before a toggle. */
  raw: string;
};

const CHECKLIST = /^(\s*[-*] \[)( |x|X)(\]\s+)(.*)$/;
// Leading "HH:MM" or "HH:MM-HH:MM" (range separators -, – or ~) followed by text.
const TIME_PREFIX = /^(\d{1,2}):(\d{2})(?:\s*[-–~]\s*(\d{1,2}):(\d{2}))?\s+(\S.*)$/;

const validClock = (h: string, m: string): boolean => Number(h) <= 23 && Number(m) <= 59;
const pad = (value: string): string => value.padStart(2, "0");

/** Splits content into lines while keeping the exact newline separators. */
const splitKeepingNewlines = (content: string): string[] => content.split(/(\r?\n)/);

export function parseScheduleItems(content: string): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const match = CHECKLIST.exec(raw);
    if (!match) continue;
    const done = match[2] !== " ";
    let title = match[4].trim();
    let time: string | undefined;
    let endTime: string | undefined;
    const timed = TIME_PREFIX.exec(title);
    if (timed && validClock(timed[1], timed[2]) && (!timed[3] || validClock(timed[3], timed[4]))) {
      time = `${pad(timed[1])}:${timed[2]}`;
      if (timed[3]) endTime = `${pad(timed[3])}:${timed[4]}`;
      title = timed[5].trim();
    }
    if (!title) continue;
    items.push({ line: index + 1, time, endTime, title, done, raw });
  }
  return items;
}

/**
 * Flips `- [ ]` ↔ `- [x]` on the given 1-based line. Returns the new content,
 * or null when that line is not a checklist item. Every other byte — including
 * CRLF line endings — is preserved exactly.
 */
export function toggleChecklistLine(content: string, line: number): string | null {
  const parts = splitKeepingNewlines(content);
  const partIndex = (line - 1) * 2;
  if (partIndex < 0 || partIndex >= parts.length) return null;
  const match = CHECKLIST.exec(parts[partIndex]);
  if (!match) return null;
  const flipped = match[2] === " " ? "x" : " ";
  parts[partIndex] = `${match[1]}${flipped}${match[3]}${match[4]}`;
  return parts.join("");
}

/**
 * Local calendar date "YYYY-MM-DD". Built from local components, never
 * toISOString(): UTC would roll the user's day over at 08:00 in UTC+8.
 */
export function formatLocalDate(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Local wall-clock minute "HH:MM". */
export function formatLocalMinute(date: Date = new Date()): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function dayNoteRelPath(dateStr: string): string {
  return `${SCHEDULE_DIR}/${dateStr}.md`;
}

/** Instantiates a user template: every {{date}} becomes the day's date. */
export function renderDayTemplate(template: string, dateStr: string): string {
  return template.replaceAll("{{date}}", dateStr);
}

/**
 * Fallback when areas/schedule/_template.md does not exist. Deliberately has no
 * checklist items — shipped sample entries would fire bogus notifications.
 */
export function defaultDayTemplate(dateStr: string): string {
  return `---\ntitle: "${dateStr} 日程"\ntype: schedule\n---\n\n# ${dateStr} 日程\n\n- [ ] \n`;
}

export function scheduleSummary(items: ScheduleItem[]): { total: number; remaining: number } {
  return { total: items.length, remaining: items.filter((item) => !item.done).length };
}

/** Identity that survives line moves and edits of other lines. */
export function itemKey(item: ScheduleItem): string {
  return `${item.time ?? ""}|${item.title}`;
}

/**
 * Unchecked timed items whose start time falls in (since, now]. `since: null`
 * (first tick of the day) narrows to exactly `now`, so launching the app at
 * 14:00 does not replay the whole morning. Zero-padded times compare as strings.
 */
export function dueItems(items: ScheduleItem[], window: { since: string | null; now: string }): ScheduleItem[] {
  return items.filter((item) => {
    if (item.done || !item.time) return false;
    if (window.since === null) return item.time === window.now;
    return item.time > window.since && item.time <= window.now;
  });
}

/** Minutes from "HH:MM" a to "HH:MM" b within one day. */
export function minutesBetween(a: string, b: string): number {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return bh * 60 + bm - (ah * 60 + am);
}
