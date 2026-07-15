import { describe, expect, it } from "vitest";
import {
  defaultDayTemplate,
  dueItems,
  formatLocalDate,
  formatLocalMinute,
  itemKey,
  minutesBetween,
  parseScheduleItems,
  renderDayTemplate,
  scheduleSummary,
  toggleChecklistLine,
} from "./schedule.js";

const note = [
  "---",
  'title: "2026-07-20 日程"',
  "type: schedule",
  "---",
  "",
  "# 2026-07-20 日程",
  "",
  "- [ ] 09:30 站会",
  "- [ ] 10:00-12:00 实习：修 ticket",
  "- [x] 8:15 晨跑",
  "- [ ] 14:00–15:00 复习（en dash）",
  "- [ ] 16:00~17:00 阅读（tilde）",
  "* [X] 整理周报",
  "  - [ ] 缩进条目",
  "- [ ] 25:99 非法时刻当标题",
  "- 普通列表行",
  "- [ ]",
].join("\n");

describe("parseScheduleItems", () => {
  const items = parseScheduleItems(note);

  it("parses timed, ranged, untimed, indented and star-bullet items", () => {
    expect(items.map((i) => i.title)).toEqual([
      "站会", "实习：修 ticket", "晨跑", "复习（en dash）", "阅读（tilde）",
      "整理周报", "缩进条目", "25:99 非法时刻当标题",
    ]);
  });

  it("normalizes times and captures ranges across all separators", () => {
    expect(items[0]).toMatchObject({ time: "09:30", endTime: undefined, done: false, line: 8 });
    expect(items[1]).toMatchObject({ time: "10:00", endTime: "12:00" });
    expect(items[2]).toMatchObject({ time: "08:15", done: true });
    expect(items[3]).toMatchObject({ time: "14:00", endTime: "15:00" });
    expect(items[4]).toMatchObject({ time: "16:00", endTime: "17:00" });
  });

  it("treats X as done and leaves invalid clock values in the title", () => {
    expect(items[5]).toMatchObject({ title: "整理周报", done: true, time: undefined });
    expect(items[7]).toMatchObject({ title: "25:99 非法时刻当标题", time: undefined });
  });

  it("skips plain list lines and empty checklist items", () => {
    expect(items).toHaveLength(8);
  });
});

describe("toggleChecklistLine", () => {
  it("toggles both directions and leaves every other line untouched", () => {
    const once = toggleChecklistLine(note, 8);
    expect(once).toContain("- [x] 09:30 站会");
    const twice = toggleChecklistLine(once!, 8);
    expect(twice).toBe(note);
  });

  it("returns null for non-checklist and out-of-range lines", () => {
    expect(toggleChecklistLine(note, 6)).toBeNull();
    expect(toggleChecklistLine(note, 999)).toBeNull();
  });

  it("preserves CRLF endings byte-for-byte", () => {
    const crlf = "- [ ] 09:00 A\r\n- [ ] B\r\n";
    const toggled = toggleChecklistLine(crlf, 2);
    expect(toggled).toBe("- [ ] 09:00 A\r\n- [x] B\r\n");
  });
});

describe("dates and templates", () => {
  it("formats local date and minute from explicit dates", () => {
    const d = new Date(2026, 6, 20, 9, 5);
    expect(formatLocalDate(d)).toBe("2026-07-20");
    expect(formatLocalMinute(d)).toBe("09:05");
  });

  it("replaces every {{date}} occurrence", () => {
    const rendered = renderDayTemplate("# {{date}}\n- [ ] 09:30 站会 {{date}}", "2026-07-20");
    expect(rendered).toBe("# 2026-07-20\n- [ ] 09:30 站会 2026-07-20");
  });

  it("default template parses to zero items", () => {
    expect(parseScheduleItems(defaultDayTemplate("2026-07-20"))).toHaveLength(0);
  });
});

describe("dueItems and helpers", () => {
  const items = parseScheduleItems("- [ ] 09:00 A\n- [ ] 09:05 B\n- [x] 09:05 C\n- [ ] D");

  it("first tick of the day matches only the exact minute", () => {
    expect(dueItems(items, { since: null, now: "09:05" }).map((i) => i.title)).toEqual(["B"]);
  });

  it("window (since, now] spans skipped minutes and excludes done/untimed", () => {
    expect(dueItems(items, { since: "08:59", now: "09:05" }).map((i) => i.title)).toEqual(["A", "B"]);
    expect(dueItems(items, { since: "09:05", now: "09:06" })).toHaveLength(0);
  });

  it("summary, key and minute math", () => {
    expect(scheduleSummary(items)).toEqual({ total: 4, remaining: 3 });
    expect(itemKey(items[0])).toBe("09:00|A");
    expect(itemKey(items[3])).toBe("|D");
    expect(minutesBetween("09:00", "09:12")).toBe(12);
    expect(minutesBetween("09:12", "09:00")).toBe(-12);
  });
});
