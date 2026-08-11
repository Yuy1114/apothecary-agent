import type { CommandResult } from "./read.js";
import { formatLocalDate } from "../../domain/journal.js";
// 纯类型引用，编译期擦除，不触发模块加载——runtime.ts 的导入时序约束不受影响。
import type { dailyPlanWorkflow } from "../../mastra/workflows/daily-plan.js";

// Mastra.getWorkflow() resolves by registration key (see runtime.ts), NOT the
// workflow's internal id — must match the key used in createCliMastra.
const DAILY_PLAN_WORKFLOW = "dailyPlanWorkflow";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 校验 YYYY-MM-DD，并拒绝 2026-13-99 这种格式合法但日期不存在的输入。 */
export function parseScheduleDate(raw: string): string {
  const match = DATE_RE.exec(raw);
  if (!match) throw new Error(`schedule 需要一个 YYYY-MM-DD 日期，收到: ${raw}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    throw new Error(`schedule 需要一个真实的 YYYY-MM-DD 日期，收到: ${raw}`);
  }
  return raw;
}

type DailyPlanWorkflow = typeof dailyPlanWorkflow;
type DailyPlanResult = Awaited<ReturnType<Awaited<ReturnType<DailyPlanWorkflow["createRun"]>>["start"]>>;

const PRIORITY_LABELS: Record<string, string> = { high: "🔴", medium: "🟡", low: "🟢" };

function reasonOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message || (error.cause !== undefined ? reasonOf(error.cause) : String(error));
  }
  if (typeof error === "object" && error !== null) {
    const candidate = error as Record<string, unknown>;
    // 运行时会抛一些非 Error 实例的对象（带 message / cause / error 字段），
    // 逐层挖到人话，而不是输出 "[object Object]"。
    if (typeof candidate.message === "string" && candidate.message !== "") return candidate.message;
    if (candidate.cause !== undefined) return reasonOf(candidate.cause);
    if (candidate.error !== undefined) return reasonOf(candidate.error);
  }
  return String(error);
}

function failure(date: string, error: unknown): CommandResult {
  const reason = reasonOf(error);
  return {
    json: { ok: false, date, error: reason },
    text: `生成 ${date} 的日程失败：${reason}`,
    exitCode: 1,
  };
}

/**
 * 跑 daily-plan workflow 生成某天（缺省今天）的日程，落盘到
 * `<vault>/schedule/<date>.md`，并把结构化结果与文本一起返回给调用方。
 *
 * 这是 CLI 里唯一会写药柜的命令，但它是设计内例外：日程是派生数据（和
 * activity digest 一个待遇），不经提案门直接落盘。workflow 不可用或生成失败
 * 时返回清晰的错误结果（exitCode 1），而不是抛异常把整个 CLI 带崩。
 */
export async function scheduleCommand(
  vaultPath: string,
  date?: string,
): Promise<CommandResult> {
  const targetDate = date === undefined ? formatLocalDate() : parseScheduleDate(date);

  try {
    // Dynamic: mastra modules read APOTHECARY_VAULT_PATH at import time (runtime.ts).
    const [{ createCliMastra }] = await Promise.all([import("../runtime.js")]);
    const { mastra } = await createCliMastra();
    const workflow = mastra.getWorkflow(DAILY_PLAN_WORKFLOW) as DailyPlanWorkflow;
    const run = await workflow.createRun();
    const outcome: DailyPlanResult = await run.start({
      inputData: { vaultPath, date: targetDate },
    });

    if (outcome.status !== "success") {
      return failure(
        targetDate,
        outcome.status === "failed" ? outcome.error : new Error(`workflow 状态 ${outcome.status}`),
      );
    }

    const schedule = outcome.result;
    const relPath = `schedule/${targetDate}.md`;

    const lines = [
      `已生成 ${targetDate} 的日程：${relPath}`,
      "",
      ...schedule.blocks.map((b) => {
        const project = b.project ? `　${b.project}` : "";
        return `  ${b.start}-${b.end}　${PRIORITY_LABELS[b.priority] ?? ""} ${b.activity}${project}`;
      }),
    ];
    if (schedule.notes) lines.push("", `备注：${schedule.notes}`);

    return {
      json: {
        ok: true,
        date: targetDate,
        file: relPath,
        blocks: schedule.blocks,
        notes: schedule.notes,
        markdown: schedule.markdown,
      },
      text: lines.join("\n"),
    };
  } catch (error) {
    return failure(targetDate, error);
  }
}
