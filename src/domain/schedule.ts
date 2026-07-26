import { z } from "zod";

/**
 * Daily schedule domain: an agent-generated time-blocked plan for one day,
 * stored as a self-contained markdown note. The schema is pure — it defines
 * the shape the agent writes and the reader/reviewer parses.
 */

export const SCHEDULE_DIR = "schedule";

export const PrioritySchema = z.enum(["high", "medium", "low"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const TimeBlockSchema = z.object({
  /** "HH:MM" wall-clock start (e.g. "09:00"). */
  start: z.string().regex(/^\d{2}:\d{2}$/),
  /** "HH:MM" wall-clock end. */
  end: z.string().regex(/^\d{2}:\d{2}$/),
  /** One-line activity description (Chinese). */
  activity: z.string().min(1),
  priority: PrioritySchema,
  /** Optional project tag for grouping (e.g. "apothecary-agent"). */
  project: z.string().optional(),
});
export type TimeBlock = z.infer<typeof TimeBlockSchema>;

export const DailyScheduleSchema = z.object({
  /** "YYYY-MM-DD" local date. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Ordered time blocks covering the day. */
  blocks: z.array(TimeBlockSchema),
  /** Free-form planner notes (optional). */
  notes: z.string().default(""),
  /** ISO timestamp when the schedule was generated. */
  generatedAt: z.string(),
});
export type DailySchedule = z.infer<typeof DailyScheduleSchema>;

export const DailyReviewSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Blocks that were completed (matched by activity text). */
  completed: z.array(z.string()),
  /** Blocks that were not completed. */
  incomplete: z.array(z.string()),
  /** Free-form reflection (Chinese). */
  reflections: z.string().default(""),
  generatedAt: z.string(),
});
export type DailyReview = z.infer<typeof DailyReviewSchema>;

/* ── Markdown rendering ─────────────────────────────────────────────── */

const PRIORITY_LABELS: Record<Priority, string> = {
  high: "🔴",
  medium: "🟡",
  low: "🟢",
};

/**
 * Render a DailySchedule into a self-contained markdown note suitable for
 * reading in Obsidian or the Hermes desktop app.
 */
export function renderScheduleMarkdown(schedule: DailySchedule): string {
  const header = [
    "---",
    `date: ${schedule.date}`,
    "type: schedule",
    `generatedAt: ${schedule.generatedAt}`,
    "---",
    "",
    `# ${schedule.date} 日程`,
    "",
    "| 时间 | 事项 | 项目 |",
    "|------|------|------|",
  ];

  const rows = schedule.blocks.map((b) => {
    const time = `${b.start}-${b.end}`;
    const label = `${PRIORITY_LABELS[b.priority]} ${b.activity}`;
    const project = b.project ?? "";
    return `| ${time} | ${label} | ${project} |`;
  });

  const footer = schedule.notes
    ? ["", "---", "", schedule.notes]
    : [];

  return [...header, ...rows, ...footer].join("\n") + "\n";
}

/**
 * Parse a schedule markdown note back into a DailySchedule.
 * Returns null when the note doesn't parse as a valid schedule.
 */
export function parseScheduleMarkdown(content: string): DailySchedule | null {
  const lines = content.split(/\r?\n/);

  // Extract frontmatter date
  const dateMatch = content.match(/^date:\s*(\d{4}-\d{2}-\d{2})/m);
  const generatedAtMatch = content.match(/^generatedAt:\s*(\S+)/m);
  if (!dateMatch) return null;

  // Parse table rows: skip header (|---|) and the header row itself
  const blocks: TimeBlock[] = [];
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith("| 时间 |")) { inTable = true; continue; }
    if (line.startsWith("|---")) continue;
    if (!inTable) continue;
    if (!line.startsWith("|")) { inTable = false; continue; }

    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;

    const [timeRange, activityCell, projectCell] = cells;
    const [start, end] = timeRange.split("-");
    if (!start || !end) continue;

    // Strip priority emoji
    const activity = activityCell.replace(/^[🔴🟡🟢]\s*/u, "").trim();
    if (!activity) continue;

    // Infer priority from emoji
    let priority: Priority = "medium";
    if (activityCell.startsWith("🔴")) priority = "high";
    else if (activityCell.startsWith("🟢")) priority = "low";

    blocks.push({
      start: start.trim(),
      end: end.trim(),
      activity,
      priority,
      project: projectCell?.trim() || undefined,
    });
  }

  if (blocks.length === 0) return null;

  // Extract notes (everything after the last table row)
  let tableEndIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("|") && lines[i].includes(" | ")) {
      tableEndIndex = i + 1; // one past the last table row
    }
  }
  let notes = "";
  if (tableEndIndex > 0 && tableEndIndex < lines.length) {
    const afterTable = lines.slice(tableEndIndex).join("\n").trim();
    // Strip the horizontal rule if present
    notes = afterTable.replace(/^---\s*\n?/, "").trim();
  }

  return {
    date: dateMatch[1],
    blocks,
    notes,
    generatedAt: generatedAtMatch?.[1] ?? new Date().toISOString(),
  };
}

/** Vault-relative path for a daily schedule note. */
export function scheduleRelPath(date: string): string {
  return `${SCHEDULE_DIR}/${date}.md`;
}
