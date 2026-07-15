import { promises as fs } from "node:fs";
import path from "node:path";
import { safeVaultPath } from "../../safety/pathSafety.js";
import { markSelfWrite } from "../../vault/selfWriteGuard.js";
import { commitSelfWrite } from "../../vault/syncSnapshot.js";
import { recordOperation } from "../../vault/operationLedger.js";
import { searchIndex } from "../ports/searchIndex.js";
import {
  TEMPLATE_REL_PATH,
  dayNoteRelPath,
  defaultDayTemplate,
  itemKey,
  parseScheduleItems,
  renderDayTemplate,
  toggleChecklistLine,
  type ScheduleItem,
} from "../../domain/schedule.js";

export type DaySchedule = {
  date: string;
  relPath: string;
  exists: boolean;
  items: ScheduleItem[];
};

const resolveDayPath = (vaultPath: string, date: string): { relPath: string; abs: string } => {
  // Strict date shape first: safeVaultPath only guards vault-root escape, while
  // a crafted "date" like ../evil would still land inside the vault but outside
  // areas/schedule/.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`invalid_schedule_date: ${date}`);
  const relPath = dayNoteRelPath(date);
  const abs = safeVaultPath(vaultPath, relPath);
  if (!abs) throw new Error(`unsafe_schedule_path: ${relPath}`);
  return { relPath, abs };
};

/**
 * The canonical vault-write sequence (mirrors writeVaultNote in
 * application/intake/ingestNote.ts). markSelfWrite/commitSelfWrite keep the
 * watcher from re-flagging our own write as an external change. Reindex is
 * best-effort here, unlike ingest: a failed embedding call must not skip
 * commitSelfWrite, or the mark TTLs out and every toggle looks external.
 */
async function writeCommitted(vaultPath: string, relPath: string, abs: string, content: string): Promise<void> {
  markSelfWrite([relPath]);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  try {
    await searchIndex().reindexFile(relPath);
  } catch {
    // Best-effort: the index catches up on the next sync.
  }
  await commitSelfWrite(vaultPath, [relPath]);
}

export async function readDaySchedule(vaultPath: string, date: string): Promise<DaySchedule> {
  const { relPath, abs } = resolveDayPath(vaultPath, date);
  const content = await fs.readFile(abs, "utf8").catch(() => null);
  if (content === null) return { date, relPath, exists: false, items: [] };
  return { date, relPath, exists: true, items: parseScheduleItems(content) };
}

/**
 * Creates areas/schedule/<date>.md from the user's _template.md (or the
 * built-in default) when missing. A deterministic copy, not an agent content
 * decision — so it does not go through the proposal gate.
 */
export async function instantiateDay(vaultPath: string, date: string): Promise<{ created: boolean; relPath: string }> {
  const { relPath, abs } = resolveDayPath(vaultPath, date);
  const existing = await fs.readFile(abs, "utf8").catch(() => null);
  if (existing !== null) return { created: false, relPath };

  const templateAbs = safeVaultPath(vaultPath, TEMPLATE_REL_PATH);
  const template = templateAbs ? await fs.readFile(templateAbs, "utf8").catch(() => null) : null;
  const content = template === null ? defaultDayTemplate(date) : renderDayTemplate(template, date);
  await writeCommitted(vaultPath, relPath, abs, content);
  await recordOperation({
    type: "capture",
    targetFiles: [relPath],
    rationale: "生成今日日程",
    source: "schedule",
  });
  return { created: true, relPath };
}

/**
 * Toggles one checklist line and returns the fresh schedule. `expectedRaw`
 * guards the stale-menu race: when the note changed since the menu was built,
 * the item is re-located by its stable key; if it is gone, nothing is written.
 */
export async function toggleScheduleItem(
  vaultPath: string,
  date: string,
  line: number,
  expectedRaw?: string,
): Promise<DaySchedule> {
  const { relPath, abs } = resolveDayPath(vaultPath, date);
  const content = await fs.readFile(abs, "utf8").catch(() => null);
  if (content === null) return { date, relPath, exists: false, items: [] };

  const items = parseScheduleItems(content);
  let target = items.find((item) => item.line === line);
  if (expectedRaw !== undefined && target && target.raw !== expectedRaw) {
    const expectedItems = parseScheduleItems(expectedRaw);
    const expectedKey = expectedItems.length === 1 ? itemKey(expectedItems[0]) : null;
    target = expectedKey ? items.find((item) => itemKey(item) === expectedKey) : undefined;
  }
  if (!target) return { date, relPath, exists: true, items };

  const next = toggleChecklistLine(content, target.line);
  if (next === null) return { date, relPath, exists: true, items };

  await writeCommitted(vaultPath, relPath, abs, next);
  await recordOperation({
    type: "edit",
    targetFiles: [relPath],
    rationale: `${target.done ? "重开" : "完成"}：${target.title}`,
    source: "schedule",
  });
  return { date, relPath, exists: true, items: parseScheduleItems(next) };
}
