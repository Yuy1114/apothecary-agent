import { describe, it, expect } from "vitest";
import {
  renderScheduleMarkdown,
  parseScheduleMarkdown,
  scheduleRelPath,
} from "./schedule.js";
import type { DailySchedule } from "./schedule.js";

const sampleSchedule: DailySchedule = {
  date: "2026-07-23",
  blocks: [
    { start: "07:30", end: "08:00", activity: "起床 + 早餐", priority: "low" },
    { start: "08:00", end: "08:30", activity: "英语学习", priority: "high", project: "english" },
    { start: "09:00", end: "18:00", activity: "Ai好记实习", priority: "high", project: "aihaoji" },
    { start: "19:00", end: "21:00", activity: "apothecary-agent 开发", priority: "medium", project: "apothecary-agent" },
  ],
  notes: "今天重点：完成 schedule domain 层。",
  generatedAt: "2026-07-23T00:00:00.000Z",
};

describe("renderScheduleMarkdown", () => {
  it("renders a full schedule as markdown", () => {
    const md = renderScheduleMarkdown(sampleSchedule);
    expect(md).toContain("date: 2026-07-23");
    expect(md).toContain("# 2026-07-23 日程");
    expect(md).toContain("| 07:30-08:00 | 🟢 起床 + 早餐 |  |");
    expect(md).toContain("| 08:00-08:30 | 🔴 英语学习 | english |");
    expect(md).toContain("今天重点：完成 schedule domain 层。");
  });

  it("round-trips through parse", () => {
    const md = renderScheduleMarkdown(sampleSchedule);
    const parsed = parseScheduleMarkdown(md);
    expect(parsed).not.toBeNull();
    expect(parsed!.date).toBe("2026-07-23");
    expect(parsed!.blocks).toHaveLength(4);
    expect(parsed!.blocks[0].activity).toBe("起床 + 早餐");
    expect(parsed!.blocks[0].priority).toBe("low");
    expect(parsed!.blocks[1].project).toBe("english");
    expect(parsed!.notes).toContain("今天重点");
  });

  it("renders without notes section when empty", () => {
    const noNotes = { ...sampleSchedule, notes: "" };
    const md = renderScheduleMarkdown(noNotes);
    // No horizontal rule or notes text after the last table row.
    const lines = md.split("\n");
    let lastTableLine = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startsWith("|")) { lastTableLine = i; break; }
    }
    const afterTable = lines.slice(lastTableLine + 1).join("\n").trim();
    expect(afterTable).toBe("");
  });
});

describe("parseScheduleMarkdown", () => {
  it("returns null for non-schedule content", () => {
    expect(parseScheduleMarkdown("# Just a note")).toBeNull();
    expect(parseScheduleMarkdown("")).toBeNull();
  });

  it("returns null when date is missing", () => {
    const noDate = "---\ntype: schedule\n---\n\n# No date\n\n| 时间 | 事项 | 项目 |\n";
    expect(parseScheduleMarkdown(noDate)).toBeNull();
  });

  it("parses priority from emoji", () => {
    const md = renderScheduleMarkdown(sampleSchedule);
    const parsed = parseScheduleMarkdown(md)!;
    expect(parsed.blocks[0].priority).toBe("low");    // 🟢
    expect(parsed.blocks[1].priority).toBe("high");   // 🔴
    expect(parsed.blocks[2].priority).toBe("high");   // 🔴
    expect(parsed.blocks[3].priority).toBe("medium"); // 🟡
  });
});

describe("scheduleRelPath", () => {
  it("returns the vault-relative path", () => {
    expect(scheduleRelPath("2026-07-23")).toBe("schedule/2026-07-23.md");
  });
});
