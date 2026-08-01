import type { AgentStatus, AttentionItem } from "../application/status/agentStatus.js";

/**
 * Human-facing rendering of a status snapshot (Chinese, per the layer language
 * convention: agent-internal data stays English, anything a person reads is
 * Chinese). Agents consume `--json` instead and phrase it themselves.
 */

const ATTENTION_LABELS: Record<AttentionItem["kind"], (item: AttentionItem) => string> = {
  proposals_pending: (i) => `${i.count} 条提案待审`,
  inbox_unfiled: (i) => `${i.count} 篇收件箱笔记未归位`,
  changes_unprocessed: (i) => `${i.count} 条变更待处理`,
  review_missing: (i) => `${i.detail ?? "昨天"} 的复盘没写`,
  profile_stale: () => `知识画像已过期`,
};

export function describeAttention(item: AttentionItem): string {
  return ATTENTION_LABELS[item.kind](item);
}

function pad(label: string): string {
  return label.padEnd(6, "　");
}

/** `generatedAt` is UTC ISO for machines; a person reading a terminal wants local time. */
function localTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function renderStatusText(status: AgentStatus): string {
  const lines: string[] = [];
  lines.push(`药柜状态 · ${localTimestamp(status.generatedAt)}`);
  lines.push(`vault  ${status.vaultPath}`);
  lines.push("");

  lines.push(`${pad("待审提案")}${status.proposals.pending}`);

  const sample = status.inbox.entries
    .slice(0, 3)
    .map((e) => e.name)
    .join("、");
  lines.push(
    `${pad("收件箱")}${status.inbox.unfiled} 篇未归位${sample ? `　（${sample}${status.inbox.unfiled > 3 ? " …" : ""}）` : ""}`,
  );

  lines.push(
    `${pad("变更队列")}${
      status.changes.degraded ? `读取失败（${status.changes.reason ?? "unknown"}）` : `${status.changes.pending} 条待处理`
    }`,
  );

  const today = status.journal.today.exists
    ? `今天 ${status.journal.today.key} 有 ${status.journal.today.planItems} 条计划`
    : `今天 ${status.journal.today.key} 未创建`;
  const yesterday = !status.journal.yesterday.exists
    ? `昨天无日记`
    : status.journal.yesterday.reviewFilled
      ? `昨天已复盘`
      : `昨天 ${status.journal.yesterday.key} 复盘未写`;
  lines.push(`${pad("日记")}${today}　·　${yesterday}`);

  lines.push(`${pad("画像")}${status.profile.stale ? "已过期，待刷新" : "最新"}`);

  lines.push("");
  if (status.attention.length === 0) {
    lines.push("没有需要你处理的事。");
  } else {
    lines.push(`需要你处理 ${status.attention.length} 项：`);
    for (const item of status.attention) lines.push(`  · ${describeAttention(item)}`);
  }

  return lines.join("\n");
}
