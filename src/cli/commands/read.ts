import { apothecaryHome } from "../../config/apothecaryHome.js";
import { buildMaintenanceFindings } from "../../domain/maintenanceFindings.js";
import { periodKeyFor, shiftPeriod } from "../../domain/journal.js";
import { collectAgentStatus } from "../../application/status/agentStatus.js";
import { readPeriod } from "../../application/journal/journalStore.js";
import { detectSupersededNotes } from "../../application/maintenance/detectSupersededNotes.js";
import { ankiConfig, findCards, invokeAnki } from "../../application/english/ankiConnect.js";
import { loadCanonicalCandidates } from "../../vault/semanticStore.js";
import { listProposals, loadProposal } from "../../vault/proposalStore.js";
import { renderStatusText } from "../renderStatus.js";

/**
 * The read-only half of the CLI. Nothing in here writes: these commands exist so
 * another agent can tell the human what is waiting, which is the whole reason
 * the CLI was built.
 *
 * Every command returns both shapes at once — the JSON an agent consumes and the
 * Chinese summary a person reads — so the two can never drift apart.
 */

export type CommandResult = {
  json: unknown;
  text: string;
  /** Non-zero marks "the command ran but could not answer", e.g. Anki is closed. */
  exitCode?: number;
};

export async function statusCommand(vaultPath: string): Promise<CommandResult> {
  const status = await collectAgentStatus(vaultPath);
  return { json: status, text: renderStatusText(status) };
}

export async function proposalsListCommand(limit?: number): Promise<CommandResult> {
  const all = await listProposals(apothecaryHome(), { status: "proposed" });
  const proposals = limit ? all.slice(0, limit) : all;
  const json = {
    pending: all.length,
    shown: proposals.length,
    proposals: proposals.map((p) => ({
      id: p.id,
      type: p.type,
      title: p.title,
      targetFiles: p.targetFiles,
      createdAt: p.createdAt,
    })),
  };

  if (all.length === 0) return { json, text: "没有待审提案。" };
  const lines = [`${all.length} 条待审提案：`, ""];
  for (const p of proposals) {
    lines.push(`  ${p.id}`);
    lines.push(`    [${p.type}] ${p.title}`);
    if (p.targetFiles.length > 0) lines.push(`    涉及 ${p.targetFiles.length} 个文件`);
  }
  lines.push("", "看详情：apo proposals show <id>；批准请在桌面 app 或 Obsidian 里操作。");
  return { json, text: lines.join("\n") };
}

export async function proposalsShowCommand(id: string): Promise<CommandResult> {
  const proposal = await loadProposal(apothecaryHome(), id);
  if (!proposal) {
    return { json: { found: false, id }, text: `找不到提案 ${id}。`, exitCode: 1 };
  }

  const lines = [
    `${proposal.id}`,
    `类型    ${proposal.type}`,
    `状态    ${proposal.status}`,
    `标题    ${proposal.title}`,
    `创建于  ${proposal.createdAt}`,
    "",
    `理由    ${proposal.rationale}`,
    "",
    `涉及文件（${proposal.targetFiles.length}）`,
    ...proposal.targetFiles.map((f) => `  · ${f}`),
  ];
  return { json: { found: true, proposal }, text: lines.join("\n") };
}

export async function askCommand(
  vaultPath: string,
  question: string,
  topK = 5,
): Promise<CommandResult> {
  // Dynamic: rag.ts freezes APOTHECARY_VAULT_PATH at import time (see runtime.ts).
  const [{ installCliPorts }, { queryVault }] = await Promise.all([
    import("../runtime.js"),
    import("../../mastra/tools/rag.js"),
  ]);
  await installCliPorts();

  const results = await queryVault(question, topK);
  const json = {
    question,
    vaultPath,
    results: results.map((r) => ({
      source: r.source,
      title: r.title,
      content: r.content,
      // Carried through deliberately: queryVault demotes rather than drops
      // superseded notes, and a caller quoting one should say so.
      supersededBy: r.supersededBy,
    })),
  };

  if (results.length === 0) {
    return { json, text: `药柜里没有找到跟「${question}」相关的内容。` };
  }
  const lines = [`「${question}」的相关片段（${results.length}）：`, ""];
  for (const r of results) {
    lines.push(`  ${r.source}${r.title ? `　${r.title}` : ""}`);
    if (r.supersededBy) lines.push(`    ⚠︎ 已被 ${r.supersededBy} 取代，优先看那一篇`);
    lines.push(`    ${r.content.replace(/\s+/g, " ").slice(0, 160)}…`);
    lines.push("");
  }
  return { json, text: lines.join("\n").trimEnd() };
}

export async function findingsCommand(vaultPath: string, limit = 20): Promise<CommandResult> {
  const [superseded, { candidates }] = await Promise.all([
    detectSupersededNotes(vaultPath),
    loadCanonicalCandidates(apothecaryHome()),
  ]);
  const all = buildMaintenanceFindings({ superseded, candidates });
  const findings = all.slice(0, limit);
  const json = { total: all.length, shown: findings.length, findings };

  if (all.length === 0) return { json, text: "没有需要处理的维护项。" };
  const lines = [`${all.length} 条维护发现：`, ""];
  for (const f of findings) {
    lines.push(`  [${f.type}] ${f.detail}`);
    lines.push(`    → ${f.suggestedAction}`);
    for (const file of f.files.slice(0, 5)) lines.push(`      · ${file}`);
  }
  return { json, text: lines.join("\n") };
}

export async function journalCommand(
  vaultPath: string,
  which: "today" | "yesterday",
): Promise<CommandResult> {
  const todayKey = periodKeyFor("daily");
  const key = which === "today" ? todayKey : shiftPeriod("daily", todayKey, -1);
  const note = await readPeriod(vaultPath, "daily", key);

  const json = {
    key,
    relPath: note.relPath,
    exists: note.exists,
    reviewFilled: note.reviewFilled,
    items: note.items.map((i) => ({ title: i.title, time: i.time, done: i.done })),
  };

  if (!note.exists) return { json, text: `${key} 还没有日记。` };
  const lines = [`${key}　${note.reviewFilled ? "已复盘" : "复盘未写"}`, ""];
  if (note.items.length === 0) {
    lines.push("  没有计划条目。");
  } else {
    for (const item of note.items) {
      lines.push(`  [${item.done ? "x" : " "}] ${item.time ? `${item.time} ` : ""}${item.title}`);
    }
  }
  return { json, text: lines.join("\n") };
}

/** Days since the most recent day with any review, from Anki's own history. */
export function daysSinceLastReview(
  byDay: [string, number][],
  today: Date = new Date(),
): number | null {
  const reviewed = byDay.filter(([, count]) => count > 0).map(([day]) => day);
  if (reviewed.length === 0) return null;
  const last = reviewed.sort().at(-1) as string;
  const lastDate = new Date(`${last}T00:00:00`);
  if (Number.isNaN(lastDate.getTime())) return null;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((startOfToday.getTime() - lastDate.getTime()) / 86_400_000));
}

export async function ankiDueCommand(): Promise<CommandResult> {
  const config = ankiConfig();
  const due = await findCards(config, "is:due");
  if (!due.ok) {
    // Anki not running is the normal case, not an error worth a stack trace.
    return {
      json: { reachable: false, reason: due.reason, detail: due.detail },
      text: `连不上 Anki（${due.reason}）。Anki 没开的时候查不到到期卡片。`,
      exitCode: 1,
    };
  }

  const [newCards, history] = await Promise.all([
    findCards(config, "is:new"),
    invokeAnki<[string, number][]>(config, "getNumCardsReviewedByDay"),
  ]);
  const idleDays = history.ok ? daysSinceLastReview(history.result) : null;

  const json = {
    reachable: true,
    due: due.result.length,
    newCards: newCards.ok ? newCards.result.length : null,
    idleDays,
  };

  const lines = [`今日到期　${due.result.length} 张`];
  if (newCards.ok) lines.push(`未学新卡　${newCards.result.length} 张`);
  if (idleDays === null) lines.push(`复习记录　没有`);
  else if (idleDays === 0) lines.push(`复习记录　今天已经复习过`);
  else lines.push(`复习记录　已断更 ${idleDays} 天`);
  return { json, text: lines.join("\n") };
}
