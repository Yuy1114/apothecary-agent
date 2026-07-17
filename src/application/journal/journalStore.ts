import { promises as fs } from "node:fs";
import path from "node:path";
import { safeVaultPath } from "../../safety/pathSafety.js";
import { markSelfWrite } from "../../vault/selfWriteGuard.js";
import { commitSelfWrite } from "../../vault/syncSnapshot.js";
import { recordOperation } from "../../vault/operationLedger.js";
import { searchIndex } from "../ports/searchIndex.js";
import {
  CADENCE_KEY_PATTERNS,
  PLAN_SECTION,
  defaultTemplate,
  insertPlanItem,
  itemKey,
  journalRelPath,
  parsePlanItems,
  periodKeyFor,
  renderTemplate,
  reviewFilled,
  templateRelPath,
  templateVars,
  toggleChecklistLine,
  type Cadence,
  type PlanItem,
} from "../../domain/journal.js";

export type PeriodNote = {
  cadence: Cadence;
  key: string;
  relPath: string;
  exists: boolean;
  items: PlanItem[];
  reviewFilled: boolean;
  content: string | null;
};

/** Where a new plan entry lands: one period's note, or a cadence template (= recurrence). */
export type PlanTarget =
  | { kind: "period"; cadence: Cadence; key: string }
  | { kind: "template"; cadence: Cadence };

const resolvePeriodPath = (vaultPath: string, cadence: Cadence, key: string): { relPath: string; abs: string } => {
  // Strict key shape first: safeVaultPath only guards vault-root escape, while
  // a crafted key like ../evil would still land inside the vault but outside
  // journal/.
  if (!CADENCE_KEY_PATTERNS[cadence].test(key)) throw new Error(`invalid_journal_key: ${cadence}/${key}`);
  const relPath = journalRelPath(cadence, key);
  const abs = safeVaultPath(vaultPath, relPath);
  if (!abs) throw new Error(`unsafe_journal_path: ${relPath}`);
  return { relPath, abs };
};

/**
 * The canonical vault-write sequence (mirrors writeVaultNote in
 * application/intake/ingestNote.ts). markSelfWrite/commitSelfWrite keep the
 * watcher from re-flagging our own write as an external change. Reindex is
 * best-effort here, unlike ingest: a failed embedding call must not skip
 * commitSelfWrite, or the mark TTLs out and every toggle looks external.
 * Exported for the sibling journal writers (activity digests).
 */
export async function writeCommitted(vaultPath: string, relPath: string, abs: string, content: string): Promise<void> {
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

const toPeriodNote = (cadence: Cadence, key: string, relPath: string, content: string | null): PeriodNote => ({
  cadence,
  key,
  relPath,
  exists: content !== null,
  items: content === null ? [] : parsePlanItems(content),
  reviewFilled: content === null ? false : reviewFilled(content),
  content,
});

export async function readPeriod(vaultPath: string, cadence: Cadence, key?: string): Promise<PeriodNote> {
  const periodKey = key ?? periodKeyFor(cadence);
  const { relPath, abs } = resolvePeriodPath(vaultPath, cadence, periodKey);
  const content = await fs.readFile(abs, "utf8").catch(() => null);
  return toPeriodNote(cadence, periodKey, relPath, content);
}

/**
 * Creates journal/<cadence>/<key>.md from the user's _templates/<cadence>.md
 * (or the built-in default) when missing. A deterministic copy, not an agent
 * content decision — so it does not go through the proposal gate.
 */
export async function instantiatePeriod(
  vaultPath: string,
  cadence: Cadence,
  key?: string,
): Promise<{ created: boolean; note: PeriodNote }> {
  const periodKey = key ?? periodKeyFor(cadence);
  const { relPath, abs } = resolvePeriodPath(vaultPath, cadence, periodKey);
  const existing = await fs.readFile(abs, "utf8").catch(() => null);
  if (existing !== null) return { created: false, note: toPeriodNote(cadence, periodKey, relPath, existing) };

  const templateAbs = safeVaultPath(vaultPath, templateRelPath(cadence));
  const template = templateAbs ? await fs.readFile(templateAbs, "utf8").catch(() => null) : null;
  const content =
    template === null ? defaultTemplate(cadence, periodKey) : renderTemplate(template, templateVars(cadence, periodKey));
  await writeCommitted(vaultPath, relPath, abs, content);
  await recordOperation({
    type: "capture",
    targetFiles: [relPath],
    rationale: `生成 ${periodKey} 日记`,
    source: "journal",
  });
  return { created: true, note: toPeriodNote(cadence, periodKey, relPath, content) };
}

/**
 * Toggles one plan line and returns the fresh period. `expectedRaw` guards the
 * stale-menu race: when the note changed since the menu/view was built, the
 * item is re-located by its stable key; if it is gone, nothing is written.
 */
export async function togglePlanItem(
  vaultPath: string,
  cadence: Cadence,
  key: string,
  line: number,
  expectedRaw?: string,
): Promise<PeriodNote> {
  const { relPath, abs } = resolvePeriodPath(vaultPath, cadence, key);
  const content = await fs.readFile(abs, "utf8").catch(() => null);
  if (content === null) return toPeriodNote(cadence, key, relPath, null);

  const items = parsePlanItems(content);
  let target = items.find((item) => item.line === line);
  if (expectedRaw !== undefined && target && target.raw !== expectedRaw) {
    const expectedItems = parsePlanItems(`## ${PLAN_SECTION}\n${expectedRaw}`);
    const expectedKey = expectedItems.length === 1 ? itemKey(expectedItems[0]) : null;
    target = expectedKey ? items.find((item) => itemKey(item) === expectedKey) : undefined;
  }
  if (!target) return toPeriodNote(cadence, key, relPath, content);

  const next = toggleChecklistLine(content, target.line);
  if (next === null) return toPeriodNote(cadence, key, relPath, content);

  await writeCommitted(vaultPath, relPath, abs, next);
  await recordOperation({
    type: "edit",
    targetFiles: [relPath],
    rationale: `${target.done ? "重开" : "完成"}：${target.title}`,
    source: "journal",
  });
  return toPeriodNote(cadence, key, relPath, next);
}

/**
 * Adds one plan entry. A period target instantiates the note first when
 * missing; a template target edits journal/_templates/<cadence>.md (creating
 * it from the built-in skeleton), which is how recurring plans work — the
 * template IS the recurrence rule, materialized on each instantiation.
 */
export async function addPlanItem(
  vaultPath: string,
  target: PlanTarget,
  item: { title: string; time?: string; endTime?: string },
): Promise<{ relPath: string; note?: PeriodNote }> {
  if (!item.title.trim()) throw new Error("empty_plan_title");

  if (target.kind === "template") {
    const relPath = templateRelPath(target.cadence);
    const abs = safeVaultPath(vaultPath, relPath);
    if (!abs) throw new Error(`unsafe_journal_path: ${relPath}`);
    // The template keeps {{placeholders}} unrendered; the built-in skeleton is
    // itself a valid template, so a fresh file starts from it.
    const existing = await fs.readFile(abs, "utf8").catch(() => null);
    const base = existing ?? defaultTemplateSkeleton(target.cadence);
    await writeCommitted(vaultPath, relPath, abs, insertPlanItem(base, item));
    await recordOperation({
      type: "edit",
      targetFiles: [relPath],
      rationale: `周期计划：${item.title}`,
      source: "journal",
    });
    return { relPath };
  }

  const { note } = await instantiatePeriod(vaultPath, target.cadence, target.key);
  const { relPath, abs } = resolvePeriodPath(vaultPath, target.cadence, target.key);
  const next = insertPlanItem(note.content ?? "", item);
  await writeCommitted(vaultPath, relPath, abs, next);
  await recordOperation({
    type: "edit",
    targetFiles: [relPath],
    rationale: `添加计划：${item.title}`,
    source: "journal",
  });
  return { relPath, note: toPeriodNote(target.cadence, target.key, relPath, next) };
}

/** The built-in template written as a *template file* — placeholders intact. */
function defaultTemplateSkeleton(cadence: Cadence): string {
  const named: Record<Cadence, string> = { daily: "date", weekly: "week", monthly: "month", yearly: "year" };
  const dateField =
    cadence === "weekly"
      ? "week: {{week}}\nstart: {{start}}\nend: {{end}}"
      : `${named[cadence]}: {{${named[cadence]}}}`;
  const sections = cadence === "daily" ? "## 计划\n\n## 日志\n\n## 复盘\n" : "## 计划\n\n## 复盘\n";
  // Preamble digest embed, same as the rendered built-in daily template.
  const preamble = cadence === "daily" ? "![[journal/digests/daily/{{date}}|当期活动摘要]]\n\n" : "";
  return `---\ntitle: "{{title}}"\ntype: journal\ncadence: ${cadence}\n${dateField}\n---\n\n# {{title}}\n\n${preamble}${sections}`;
}
