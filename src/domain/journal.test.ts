import { describe, expect, it } from "vitest";
import {
  defaultTemplate,
  dueItems,
  formatLocalDate,
  formatLocalMinute,
  insertPlanItem,
  itemKey,
  journalRelPath,
  minutesBetween,
  parsePlanItems,
  periodKeyFor,
  periodRange,
  periodTitle,
  planSummary,
  renderTemplate,
  reviewFilled,
  sectionRange,
  shiftPeriod,
  templateVars,
  toggleChecklistLine,
} from "./journal.js";

const note = [
  "---",
  'title: "2026-07-20 日记"',
  "type: journal",
  "---",
  "",
  "# 2026-07-20 日记",
  "",
  "## 计划",
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
  "",
  "## 日志",
  "",
  "- [ ] 日志里引用的任务清单，不是计划",
  "",
  "## 复盘",
  "",
].join("\n");

describe("parsePlanItems（区块作用域）", () => {
  const items = parsePlanItems(note);

  it("parses timed, ranged, untimed, indented and star-bullet items", () => {
    expect(items.map((i) => i.title)).toEqual([
      "站会", "实习：修 ticket", "晨跑", "复习（en dash）", "阅读（tilde）",
      "整理周报", "缩进条目", "25:99 非法时刻当标题",
    ]);
  });

  it("normalizes times and captures ranges across all separators", () => {
    expect(items[0]).toMatchObject({ time: "09:30", endTime: undefined, done: false, line: 10 });
    expect(items[1]).toMatchObject({ time: "10:00", endTime: "12:00" });
    expect(items[2]).toMatchObject({ time: "08:15", done: true });
    expect(items[3]).toMatchObject({ time: "14:00", endTime: "15:00" });
    expect(items[4]).toMatchObject({ time: "16:00", endTime: "17:00" });
  });

  it("treats X as done and leaves invalid clock values in the title", () => {
    expect(items[5]).toMatchObject({ title: "整理周报", done: true, time: undefined });
    expect(items[7]).toMatchObject({ title: "25:99 非法时刻当标题", time: undefined });
  });

  it("ignores checklists outside the 计划 section and notes without one", () => {
    expect(items).toHaveLength(8); // 日志 里的 checklist 不在内
    expect(parsePlanItems("- [ ] 09:00 无区块笔记")).toHaveLength(0);
  });
});

describe("sectionRange / reviewFilled", () => {
  it("locates a section body up to the next same-level heading", () => {
    const range = sectionRange(note, "计划")!;
    expect(range.headingLine).toBe(8);
    expect(range.endLine).toBe(20); // ## 日志 在第 21 行
  });

  it("last section runs to EOF; missing section is null", () => {
    expect(sectionRange(note, "复盘")!.endLine).toBe(note.split("\n").length);
    expect(sectionRange(note, "不存在")).toBeNull();
  });

  it("reviewFilled: blank review section is false, any prose is true", () => {
    expect(reviewFilled(note)).toBe(false);
    expect(reviewFilled(`${note}\n今天推进了日记功能。`)).toBe(true);
    expect(reviewFilled("no sections at all")).toBe(false);
  });
});

describe("insertPlanItem", () => {
  it("appends after the last non-blank plan line, preserving the rest", () => {
    const next = insertPlanItem(note, { title: "写周报", time: "17:30" });
    const lines = next.split("\n");
    expect(lines[19]).toBe("- [ ] 17:30 写周报"); // 原 `- [ ]` 空条目行之后
    expect(next.replace("- [ ] 17:30 写周报\n", "")).toBe(note);
  });

  it("inserts right after the heading when the section is empty", () => {
    const empty = "# t\n\n## 计划\n\n## 复盘\n";
    const next = insertPlanItem(empty, { title: "A" });
    expect(next).toBe("# t\n\n## 计划\n- [ ] A\n\n## 复盘\n");
  });

  it("appends a new 计划 section when missing and keeps CRLF style", () => {
    expect(insertPlanItem("# t", { title: "A", time: "09:00", endTime: "10:00" }))
      .toBe("# t\n\n## 计划\n\n- [ ] 09:00-10:00 A\n");
    const crlf = "## 计划\r\n\r\n- [ ] 已有\r\n";
    expect(insertPlanItem(crlf, { title: "B" })).toBe("## 计划\r\n\r\n- [ ] 已有\r\n- [ ] B\r\n");
  });
});

describe("toggleChecklistLine", () => {
  it("toggles both directions and leaves every other line untouched", () => {
    const once = toggleChecklistLine(note, 10);
    expect(once).toContain("- [x] 09:30 站会");
    const twice = toggleChecklistLine(once!, 10);
    expect(twice).toBe(note);
  });

  it("returns null for non-checklist and out-of-range lines", () => {
    expect(toggleChecklistLine(note, 6)).toBeNull();
    expect(toggleChecklistLine(note, 999)).toBeNull();
  });

  it("preserves CRLF endings byte-for-byte", () => {
    const crlf = "- [ ] 09:00 A\r\n- [ ] B\r\n";
    expect(toggleChecklistLine(crlf, 2)).toBe("- [ ] 09:00 A\r\n- [x] B\r\n");
  });
});

describe("periods", () => {
  it("computes keys for every cadence from one date", () => {
    const d = new Date(2026, 6, 16); // 2026-07-16 周四
    expect(periodKeyFor("daily", d)).toBe("2026-07-16");
    expect(periodKeyFor("weekly", d)).toBe("2026-W29");
    expect(periodKeyFor("monthly", d)).toBe("2026-07");
    expect(periodKeyFor("yearly", d)).toBe("2026");
  });

  it("ISO week year-boundary edges", () => {
    expect(periodKeyFor("weekly", new Date(2026, 0, 1))).toBe("2026-W01"); // 2026-01-01 周四
    expect(periodKeyFor("weekly", new Date(2027, 0, 1))).toBe("2026-W53"); // 2027-01-01 周五 → 2026 年第 53 周
    expect(periodKeyFor("weekly", new Date(2024, 11, 30))).toBe("2025-W01"); // 2024-12-30 周一 → 2025-W01
  });

  it("shiftPeriod navigates neighbours incl. rollovers", () => {
    expect(shiftPeriod("daily", "2026-08-01", -1)).toBe("2026-07-31");
    expect(shiftPeriod("weekly", "2026-W53", 1)).toBe("2027-W01");
    expect(shiftPeriod("weekly", "2027-W01", -1)).toBe("2026-W53");
    expect(shiftPeriod("monthly", "2026-12", 1)).toBe("2027-01");
    expect(shiftPeriod("yearly", "2026", -1)).toBe("2025");
  });

  it("periodRange covers the calendar span", () => {
    expect(periodRange("daily", "2026-07-16")).toEqual({ start: "2026-07-16", end: "2026-07-16" });
    expect(periodRange("weekly", "2026-W29")).toEqual({ start: "2026-07-13", end: "2026-07-19" });
    expect(periodRange("monthly", "2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(periodRange("monthly", "2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(periodRange("yearly", "2026")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });

  it("paths and titles", () => {
    expect(journalRelPath("weekly", "2026-W29")).toBe("journal/weekly/2026-W29.md");
    expect(periodTitle("daily", "2026-07-16")).toBe("2026-07-16 日记");
    expect(periodTitle("weekly", "2026-W29")).toBe("2026-W29 周复盘");
  });
});

describe("dates and templates", () => {
  it("formats local date and minute from explicit dates", () => {
    const d = new Date(2026, 6, 20, 9, 5);
    expect(formatLocalDate(d)).toBe("2026-07-20");
    expect(formatLocalMinute(d)).toBe("09:05");
  });

  it("renderTemplate replaces every occurrence of every var", () => {
    const rendered = renderTemplate("# {{title}}\n{{start}}~{{end}} {{week}} {{week}}", templateVars("weekly", "2026-W29"));
    expect(rendered).toBe("# 2026-W29 周复盘\n2026-07-13~2026-07-19 2026-W29 2026-W29");
  });

  it("default templates carry the section skeleton and zero plan items", () => {
    const daily = defaultTemplate("daily", "2026-07-20");
    expect(daily).toContain("## 计划");
    expect(daily).toContain("## 日志");
    expect(daily).toContain("## 复盘");
    expect(parsePlanItems(daily)).toHaveLength(0);
    const weekly = defaultTemplate("weekly", "2026-W29");
    expect(weekly).toContain("start: 2026-07-13");
    expect(weekly).not.toContain("## 日志");
    expect(reviewFilled(weekly)).toBe(false);
  });
});

describe("dueItems and helpers", () => {
  const items = parsePlanItems("## 计划\n- [ ] 09:00 A\n- [ ] 09:05 B\n- [x] 09:05 C\n- [ ] D");

  it("first tick of the day matches only the exact minute", () => {
    expect(dueItems(items, { since: null, now: "09:05" }).map((i) => i.title)).toEqual(["B"]);
  });

  it("window (since, now] spans skipped minutes and excludes done/untimed", () => {
    expect(dueItems(items, { since: "08:59", now: "09:05" }).map((i) => i.title)).toEqual(["A", "B"]);
    expect(dueItems(items, { since: "09:05", now: "09:06" })).toHaveLength(0);
  });

  it("summary, key and minute math", () => {
    expect(planSummary(items)).toEqual({ total: 4, remaining: 3 });
    expect(itemKey(items[0])).toBe("09:00|A");
    expect(itemKey(items[3])).toBe("|D");
    expect(minutesBetween("09:00", "09:12")).toBe(12);
    expect(minutesBetween("09:12", "09:00")).toBe(-12);
  });
});
