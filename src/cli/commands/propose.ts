import { apothecaryHome } from "../../config/apothecaryHome.js";
import { PolishModeSchema, type PolishMode } from "../../domain/notePolish.js";
import { proposeReadmeFixes } from "../../application/maintenance/auditReadmes.js";
import { createProposal } from "../../vault/proposalStore.js";
import type { CommandResult } from "./read.js";

/**
 * The proposing half of the CLI. These commands do real work — surveying the
 * inbox, drafting a note rewrite — but their only output is a proposal awaiting
 * approval. None of them touch the vault.
 *
 * That is the consent gate the whole project is built around, and it is what
 * makes it safe to let an unattended agent (Hermes, cron) call these: the worst
 * case is a proposal Yuy rejects.
 */

/** First meaningful line of a capture, trimmed to something that reads as a title. */
export function captureTitle(content: string, max = 40): string {
  const firstLine = content
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line.length > 0);
  if (!firstLine) return "捕获的内容";
  return firstLine.length > max ? `${firstLine.slice(0, max)}…` : firstLine;
}

export async function captureCommand(
  content: string,
  options: { topic?: string; source?: string } = {},
): Promise<CommandResult> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("capture 需要非空内容");

  const source = options.source ?? "cli";
  const proposal = await createProposal(apothecaryHome(), {
    type: "capture",
    title: captureTitle(trimmed),
    rationale: `经由 ${source} 捕获。内容尚未写入药柜：采纳后才会落盘。`,
    payload: { content: trimmed, topic: options.topic },
  });

  return {
    json: { proposalId: proposal.id, type: proposal.type, topic: options.topic ?? null },
    text: [
      `已起草 capture 提案 ${proposal.id}`,
      `标题　${proposal.title}`,
      options.topic ? `目标　${options.topic}` : `目标　未指定（采纳后落 _inbox/）`,
      "",
      "内容还没有写进药柜，等你批准。",
    ].join("\n"),
  };
}

export async function intakePlanCommand(): Promise<CommandResult> {
  // Dynamic: the watcher module freezes APOTHECARY_VAULT_PATH at import time.
  const [{ createCliMastra }, { runAutoIntake, getAutoIntakeStatus }] = await Promise.all([
    import("../runtime.js"),
    import("../../mastra/workflows/sync-watcher.js"),
  ]);

  const { mastra } = await createCliMastra();
  // runAutoIntake reports failure through its phase rather than throwing, so the
  // CLI has to read the phase back to know whether it can exit 0.
  await runAutoIntake(mastra);
  const status = getAutoIntakeStatus();

  if (status.phase === "failed") {
    return {
      json: { ok: false, error: status.lastError ?? "unknown" },
      text: `勘查 _inbox 失败：${status.lastError ?? "未知错误"}`,
      exitCode: 1,
    };
  }
  if (status.phase !== "proposed" || !status.lastProposalId) {
    return {
      json: { ok: true, proposalId: null, actionable: 0 },
      text: "_inbox 里没有可以归位的东西（低置信度的条目会留在原地）。",
    };
  }

  return {
    json: { ok: true, proposalId: status.lastProposalId, actionable: status.actionable ?? 0 },
    text: [
      `已起草归位提案 ${status.lastProposalId}`,
      `可执行决策　${status.actionable ?? 0} 条`,
      "",
      "文件一个都没动，等你批准。看详情：apo proposals show " + status.lastProposalId,
    ].join("\n"),
  };
}

export async function auditReadmeCommand(vaultPath: string): Promise<CommandResult> {
  const result = await proposeReadmeFixes(vaultPath, apothecaryHome());
  const json = result as unknown;

  if (result.proposalIds.length === 0) {
    return { json, text: "README 与实际文件是一致的，没有要改的。" };
  }
  const lines = [`起草了 ${result.proposalIds.length} 条 README 修订提案：`, ""];
  for (const finding of result.findings) lines.push(`  ${finding.dir}　${finding.summary}`);
  lines.push("", "都还没落盘，等你批准。");
  return { json, text: lines.join("\n") };
}

export function parsePolishModes(raw: string[]): PolishMode[] {
  if (raw.length === 0) throw new Error("polish 需要至少一个 --mode（expand|format|tags|condense）");
  return raw.map((mode) => {
    const parsed = PolishModeSchema.safeParse(mode);
    if (!parsed.success) throw new Error(`未知的 --mode: ${mode}（可选 expand|format|tags|condense）`);
    return parsed.data;
  });
}

export async function polishCommand(
  vaultPath: string,
  filePath: string,
  rawModes: string[],
): Promise<CommandResult> {
  const modes = parsePolishModes(rawModes);
  const [{ installCliPorts }, { polishNote }, { mastraNotePolisher }] = await Promise.all([
    import("../runtime.js"),
    import("../../application/notes/polishNote.js"),
    import("../../mastra/adapters/mastraNotePolisher.js"),
  ]);
  // Polishing grounds itself in related notes, so the vector index must be live.
  await installCliPorts();

  const result = await polishNote({ vaultPath, filePath, modes }, mastraNotePolisher);
  return {
    json: result,
    text: [
      `已起草编辑提案 ${result.proposalId}`,
      `文件　${result.filePath}`,
      `模式　${result.modes.join(", ")}`,
      "",
      result.changeSummary,
      "",
      "原文件未改动，等你批准。",
    ].join("\n"),
  };
}

/**
 * 描述药柜里的图片，让它们可被检索。Maintenance, not a proposal: descriptions
 * are derived data under the agent's own home and never touch the vault.
 */
export async function describeImagesCommand(
  vaultPath: string,
  options: { limit?: number; force?: boolean } = {},
): Promise<CommandResult> {
  // Dynamic: installing the ports pulls in rag.ts, which freezes the vault path.
  const [{ installCliPorts }, { describeVaultImages }] = await Promise.all([
    import("../runtime.js"),
    import("../../application/images/describeVaultImages.js"),
  ]);
  await installCliPorts();

  try {
    const report = await describeVaultImages({ vaultPath, ...options });
    const lines = [
      `图片 ${report.total} 张：本次描述 ${report.described} · 已是最新 ${report.upToDate}`,
    ];
    if (report.failed.length > 0) {
      lines.push(`失败 ${report.failed.length} 张：`);
      for (const failure of report.failed.slice(0, 5)) {
        lines.push(`  · ${failure.path} — ${failure.reason}`);
      }
    }
    if (report.pruned > 0) lines.push(`清掉 ${report.pruned} 条已不存在图片的记录`);
    if (report.more) lines.push("", "还有没描述完的，再跑一次继续（已完成的不会重复付费）。");
    else if (report.described > 0) lines.push("", '现在可以搜图了，例如：apo ask "那张讲 Redis 的截图"');
    return { json: report, text: lines.join("\n") };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (reason === "no_vision_model_configured") {
      return {
        json: { ok: false, error: reason },
        text: "没有配置视觉模型。设置 APOTHECARY_VISION_MODEL（凭据默认复用 embedding 那套）后再试。",
        exitCode: 1,
      };
    }
    throw error;
  }
}
