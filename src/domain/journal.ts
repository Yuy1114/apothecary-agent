// Journal (日记) domain: the unified daily/weekly/monthly/yearly note format.
// Each period is one vault note — `## 计划` (checklist the tray/ticker act on),
// `## 日志` (daily prose), `## 复盘` (review; non-empty means "reviewed").
// The vault note is the source of truth — everything here is a pure projection
// of its text, so the desktop tray, the ticker, the journal view and tests all
// agree.

export const JOURNAL_DIR = "journal";

export type Cadence = "daily" | "weekly" | "monthly" | "yearly";
export const CADENCES: Cadence[] = ["daily", "weekly", "monthly", "yearly"];

export const PLAN_SECTION = "计划";
export const LOG_SECTION = "日志";
export const REVIEW_SECTION = "复盘";

export type PlanItem = {
  /** 1-based line number in the whole note (matches MarkdownHeading.line convention). */
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
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

const validClock = (h: string, m: string): boolean => Number(h) <= 23 && Number(m) <= 59;
const pad = (value: string | number): string => String(value).padStart(2, "0");

/** Splits content into lines while keeping the exact newline separators. */
const splitKeepingNewlines = (content: string): string[] => content.split(/(\r?\n)/);

/* ── Sections ────────────────────────────────────────────────────────── */

export type SectionRange = {
  /** 1-based line of the `## <name>` heading itself. */
  headingLine: number;
  /** 1-based first body line (headingLine + 1). */
  startLine: number;
  /** 1-based last body line (inclusive); ends before the next same-or-higher heading. */
  endLine: number;
};

/** Locate the section under the first heading whose text equals `name`. */
export function sectionRange(content: string, name: string): SectionRange | null {
  const lines = content.split(/\r?\n/);
  let headingLine = -1;
  let level = 0;
  for (let index = 0; index < lines.length; index++) {
    const match = HEADING.exec(lines[index]);
    if (!match) continue;
    if (headingLine < 0) {
      if (match[2].trim() === name) {
        headingLine = index + 1;
        level = match[1].length;
      }
    } else if (match[1].length <= level) {
      return { headingLine, startLine: headingLine + 1, endLine: index };
    }
  }
  return headingLine < 0 ? null : { headingLine, startLine: headingLine + 1, endLine: lines.length };
}

/**
 * Plan items are ONLY the checklist lines inside `## 计划` — a checklist in the
 * prose sections (e.g. a quoted task list in the 日志) must not become a
 * reminder. Line numbers stay absolute so toggling works on the whole note.
 */
export function parsePlanItems(content: string): PlanItem[] {
  const section = sectionRange(content, PLAN_SECTION);
  if (!section) return [];
  const items: PlanItem[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = section.startLine - 1; index < section.endLine; index++) {
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

/** One section's body text (trimmed), or null when the section is missing. */
export function sectionBody(content: string, name: string): string | null {
  const section = sectionRange(content, name);
  if (!section) return null;
  const lines = content.split(/\r?\n/);
  return lines.slice(section.startLine - 1, section.endLine).join("\n").trim();
}

/** The review section counts as written once it has any non-blank body line. */
export function reviewFilled(content: string): boolean {
  const section = sectionRange(content, REVIEW_SECTION);
  if (!section) return false;
  const lines = content.split(/\r?\n/);
  for (let index = section.startLine - 1; index < section.endLine; index++) {
    if (lines[index]?.trim()) return true;
  }
  return false;
}

/** Renders `- [ ] [HH:MM[-HH:MM] ]title` for a new plan entry. */
export function planItemLine(item: { title: string; time?: string; endTime?: string }): string {
  const clock = item.time ? `${item.time}${item.endTime ? `-${item.endTime}` : ""} ` : "";
  return `- [ ] ${clock}${item.title.trim()}`;
}

/**
 * Inserts one checklist line at the end of the `## 计划` section (right after
 * its last non-blank line, or right after the heading when empty). Every other
 * byte — including CRLF endings — is preserved; a missing section is appended.
 */
export function insertPlanItem(
  content: string,
  item: { title: string; time?: string; endTime?: string },
): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const entry = planItemLine(item);
  const section = sectionRange(content, PLAN_SECTION);
  if (!section) {
    const base = content.length === 0 || content.endsWith("\n") ? content : `${content}${eol}`;
    return `${base}${eol}## ${PLAN_SECTION}${eol}${eol}${entry}${eol}`;
  }

  const parts = splitKeepingNewlines(content);
  const lineText = (line: number): string => parts[(line - 1) * 2] ?? "";
  let anchor = section.headingLine;
  for (let line = section.endLine; line >= section.startLine; line--) {
    if (lineText(line).trim()) {
      anchor = line;
      break;
    }
  }
  // Splice "entry + newline" in right after the anchor line's own separator;
  // an anchor at EOF without a trailing newline gets one first.
  const anchorPartIndex = (anchor - 1) * 2;
  const hasSeparator = anchorPartIndex + 1 < parts.length;
  const insertAt = hasSeparator ? anchorPartIndex + 2 : anchorPartIndex + 1;
  parts.splice(insertAt, 0, ...(hasSeparator ? [entry, eol] : [eol, entry, eol]));
  return parts.join("");
}

/**
 * Replaces one section's body (the lines between its heading and the next
 * same-or-higher heading) with `body`, preserving every byte outside that
 * region. Returns null when the section does not exist — callers decide
 * whether that is an error. The new body is framed by single blank lines so
 * the note keeps its section rhythm.
 */
export function replaceSectionBody(content: string, name: string, body: string): string | null {
  const section = sectionRange(content, name);
  if (!section) return null;
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const parts = splitKeepingNewlines(content);

  // Prefix: everything up to and including the heading line (add its missing
  // separator when the heading sits at EOF).
  const headingPartIndex = (section.headingLine - 1) * 2;
  const prefix = parts.slice(0, headingPartIndex + 1).join("") + (parts[headingPartIndex + 1] ?? eol);
  // Suffix: everything from the line after the section's last body line.
  const suffix = parts.slice(section.endLine * 2).join("");

  const bodyLines = body.replace(/\s+$/, "").split(/\r?\n/);
  const framed = [""].concat(bodyLines).concat(suffix ? [""] : []);
  return prefix + framed.map((line) => `${line}${eol}`).join("") + suffix;
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

/* ── Periods ─────────────────────────────────────────────────────────── */

/**
 * Local calendar date "YYYY-MM-DD". Built from local components, never
 * toISOString(): UTC would roll the user's day over at 08:00 in UTC+8.
 */
export function formatLocalDate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local wall-clock minute "HH:MM". */
export function formatLocalMinute(date: Date = new Date()): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const CADENCE_KEY_PATTERNS: Record<Cadence, RegExp> = {
  daily: /^\d{4}-\d{2}-\d{2}$/,
  weekly: /^\d{4}-W\d{2}$/,
  monthly: /^\d{4}-\d{2}$/,
  yearly: /^\d{4}$/,
};

const dateFromDailyKey = (key: string): Date => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** ISO week (Monday-based; the week's year is its Thursday's year). */
function isoWeekOf(date: Date): { isoYear: number; week: number } {
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7) + 3);
  const isoYear = thursday.getFullYear();
  const jan4 = new Date(isoYear, 0, 4);
  const week1Thursday = new Date(isoYear, 0, 4 - ((jan4.getDay() + 6) % 7) + 3);
  const week = 1 + Math.round((thursday.getTime() - week1Thursday.getTime()) / (7 * 86_400_000));
  return { isoYear, week };
}

function mondayOfIsoWeek(isoYear: number, week: number): Date {
  const jan4 = new Date(isoYear, 0, 4);
  const week1Monday = new Date(isoYear, 0, 4 - ((jan4.getDay() + 6) % 7));
  return new Date(week1Monday.getFullYear(), week1Monday.getMonth(), week1Monday.getDate() + (week - 1) * 7);
}

const mondayOfWeeklyKey = (key: string): Date => {
  const [isoYear, week] = key.split("-W").map(Number);
  return mondayOfIsoWeek(isoYear, week);
};

/** The period key containing `date` for a cadence: 2026-07-16 / 2026-W29 / 2026-07 / 2026. */
export function periodKeyFor(cadence: Cadence, date: Date = new Date()): string {
  switch (cadence) {
    case "daily":
      return formatLocalDate(date);
    case "weekly": {
      const { isoYear, week } = isoWeekOf(date);
      return `${isoYear}-W${pad(week)}`;
    }
    case "monthly":
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    case "yearly":
      return String(date.getFullYear());
  }
}

/** Neighbouring period key (delta = ±1). */
export function shiftPeriod(cadence: Cadence, key: string, delta: 1 | -1): string {
  switch (cadence) {
    case "daily": {
      const date = dateFromDailyKey(key);
      date.setDate(date.getDate() + delta);
      return formatLocalDate(date);
    }
    case "weekly": {
      const monday = mondayOfWeeklyKey(key);
      monday.setDate(monday.getDate() + 7 * delta);
      return periodKeyFor("weekly", monday);
    }
    case "monthly": {
      const [y, m] = key.split("-").map(Number);
      return periodKeyFor("monthly", new Date(y, m - 1 + delta, 1));
    }
    case "yearly":
      return String(Number(key) + delta);
  }
}

/** First and last local calendar day of a period, both "YYYY-MM-DD". */
export function periodRange(cadence: Cadence, key: string): { start: string; end: string } {
  switch (cadence) {
    case "daily":
      return { start: key, end: key };
    case "weekly": {
      const monday = mondayOfWeeklyKey(key);
      const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
      return { start: formatLocalDate(monday), end: formatLocalDate(sunday) };
    }
    case "monthly": {
      const [y, m] = key.split("-").map(Number);
      return { start: `${key}-01`, end: formatLocalDate(new Date(y, m, 0)) };
    }
    case "yearly":
      return { start: `${key}-01-01`, end: `${key}-12-31` };
  }
}

export function journalRelPath(cadence: Cadence, key: string): string {
  return `${JOURNAL_DIR}/${cadence}/${key}.md`;
}

export function templateRelPath(cadence: Cadence): string {
  return `${JOURNAL_DIR}/_templates/${cadence}.md`;
}

export const PERIOD_TITLES: Record<Cadence, string> = {
  daily: "日记",
  weekly: "周复盘",
  monthly: "月复盘",
  yearly: "年复盘",
};

export function periodTitle(cadence: Cadence, key: string): string {
  return `${key} ${PERIOD_TITLES[cadence]}`;
}

/* ── Templates ───────────────────────────────────────────────────────── */

/** Instantiates a template: every {{name}} is replaced from `vars`. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  let rendered = template;
  for (const [name, value] of Object.entries(vars)) rendered = rendered.replaceAll(`{{${name}}}`, value);
  return rendered;
}

/** Placeholder values available to user templates for one period. */
export function templateVars(cadence: Cadence, key: string): Record<string, string> {
  const { start, end } = periodRange(cadence, key);
  const named: Record<Cadence, string> = { daily: "date", weekly: "week", monthly: "month", yearly: "year" };
  return { key, [named[cadence]]: key, start, end, title: periodTitle(cadence, key) };
}

/**
 * Fallback when journal/_templates/<cadence>.md does not exist. Deliberately
 * has no checklist items — shipped sample entries would fire bogus
 * notifications. Daily carries a 日志 section; coarser cadences plan + review.
 */
export function defaultTemplate(cadence: Cadence, key: string): string {
  const vars = templateVars(cadence, key);
  const dateField: Record<Cadence, string> = {
    daily: `date: ${key}`,
    weekly: `week: ${key}\nstart: ${vars.start}\nend: ${vars.end}`,
    monthly: `month: ${key}`,
    yearly: `year: ${key}`,
  };
  const sections =
    cadence === "daily"
      ? `## ${PLAN_SECTION}\n\n## ${LOG_SECTION}\n\n## ${REVIEW_SECTION}\n`
      : `## ${PLAN_SECTION}\n\n## ${REVIEW_SECTION}\n`;
  // The digest embed sits in the preamble (before any `##`), so it belongs to
  // no section: reviewFilled/parsePlanItems never see it, Obsidian renders the
  // machine-written digest inline in the human's note.
  const preamble = cadence === "daily" ? `${digestEmbedLine(cadence, key)}\n\n` : "";
  return `---\ntitle: "${vars.title}"\ntype: journal\ncadence: ${cadence}\n${dateField[cadence]}\n---\n\n# ${vars.title}\n\n${preamble}${sections}`;
}

/* ── Activity digests ────────────────────────────────────────────────── */

// Machine-owned namespace inside the vault: the agent regenerates these files
// freely (no proposal gate — they are derived data, like the semantic layer),
// humans read but do not edit. Audience is "everyone": Yuy, apothecary itself,
// and external agents wanting to know recent activity.
export const DIGEST_DIR = `${JOURNAL_DIR}/digests`;

export function digestRelPath(cadence: Cadence, key: string): string {
  return `${DIGEST_DIR}/${cadence}/${key}.md`;
}

export function digestTitle(key: string): string {
  return `${key} 活动摘要`;
}

/** Obsidian embed of a period's digest, aliased for the human reader. */
export function digestEmbedLine(cadence: Cadence, key: string): string {
  // Wiki links resolve without the extension; that is also Obsidian's own style.
  return `![[${digestRelPath(cadence, key).replace(/\.md$/, "")}|当期活动摘要]]`;
}

/** Everything the digest reports, already mapped to plain domain terms. */
export type DigestFacts = {
  /** External work from the change ledger — the human's own edits. */
  userChanges: Array<{ kind: "created" | "modified" | "deleted"; path: string }>;
  /** Applied agent operations; relocations carry the original path. */
  agentOperations: Array<{ type: string; path: string; fromPath?: string; detail?: string }>;
  /** Proposals resolved inside the period. */
  proposals: Array<{ title: string; outcome: "applied" | "rejected" }>;
};

export const emptyDigestFacts = (): DigestFacts => ({ userChanges: [], agentOperations: [], proposals: [] });

export const DIGEST_SUMMARY_SECTION = "摘要";
export const DIGEST_FACTS_SECTION = "明细";

/** Shown in `## 摘要` when the LLM narrative is unavailable — facts still land. */
export const DIGEST_SUMMARY_FALLBACK = "（本期摘要生成失败，明细如下。）";

const CHANGE_KIND_LABELS: Record<DigestFacts["userChanges"][number]["kind"], string> = {
  created: "新增",
  modified: "修改",
  deleted: "删除",
};
const OPERATION_LABELS: Record<string, string> = {
  edit: "编辑",
  move: "归位",
  archive: "归档",
  merge: "合并",
  promote: "视图转正",
  canonical: "主笔记",
  structure: "结构调整",
  ingest: "收录",
  capture: "生成",
};

const bulletList = (lines: string[]): string => (lines.length === 0 ? "- 无" : lines.join("\n"));

export const digestFactCount = (facts: DigestFacts): number =>
  facts.userChanges.length + facts.agentOperations.length + facts.proposals.length;

/** The `## 明细` body — pure ledger facts, also what the summary writer reads. */
export function renderDigestFacts(facts: DigestFacts): string {
  const changes = facts.userChanges.map((c) => `- ${CHANGE_KIND_LABELS[c.kind]} ${c.path}`);
  const operations = facts.agentOperations.map((op) => {
    const label = OPERATION_LABELS[op.type] ?? op.type;
    const subject = op.fromPath ? `${op.fromPath} → ${op.path}` : op.path;
    return `- ${label} ${subject}${op.detail ? `（${op.detail}）` : ""}`;
  });
  const proposals = facts.proposals.map((p) => `- ${p.outcome === "applied" ? "已采纳" : "已拒绝"}：${p.title}`);
  return [
    "### 你的改动",
    bulletList(changes),
    "",
    "### Agent 操作",
    bulletList(operations),
    "",
    "### 提案",
    bulletList(proposals),
  ].join("\n");
}

/**
 * Renders the digest note deterministically: `## 明细` comes verbatim from the
 * ledgers (zero hallucination, machine-parsable), `## 摘要` is the caller's
 * narrative (LLM output or the fallback placeholder).
 */
export function renderDigest(
  cadence: Cadence,
  key: string,
  facts: DigestFacts,
  summary: string,
  generatedAt: string,
): string {
  const title = digestTitle(key);
  const named: Record<Cadence, string> = { daily: "date", weekly: "week", monthly: "month", yearly: "year" };
  const { start, end } = periodRange(cadence, key);
  const rangeField = cadence === "daily" ? "" : `start: ${start}\nend: ${end}\n`;

  return [
    "---",
    `title: "${title}"`,
    "type: activity-digest",
    `cadence: ${cadence}`,
    `${named[cadence]}: ${key}`,
    `${rangeField}generatedAt: ${generatedAt}`,
    "---",
    "",
    `# ${title}`,
    "",
    `## ${DIGEST_SUMMARY_SECTION}`,
    "",
    summary.trim() || DIGEST_SUMMARY_FALLBACK,
    "",
    `## ${DIGEST_FACTS_SECTION}`,
    "",
    renderDigestFacts(facts),
    "",
  ].join("\n");
}

/* ── Plan summaries & reminders ──────────────────────────────────────── */

export function planSummary(items: PlanItem[]): { total: number; remaining: number } {
  return { total: items.length, remaining: items.filter((item) => !item.done).length };
}

/** Identity that survives line moves and edits of other lines. */
export function itemKey(item: PlanItem): string {
  return `${item.time ?? ""}|${item.title}`;
}

/**
 * Unchecked timed items whose start time falls in (since, now]. `since: null`
 * (first tick of the day) narrows to exactly `now`, so launching the app at
 * 14:00 does not replay the whole morning. Zero-padded times compare as strings.
 */
export function dueItems(items: PlanItem[], window: { since: string | null; now: string }): PlanItem[] {
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
