import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { saveSchedule } from "../../application/schedule/scheduleStore.js";
import { scheduleAgent, ScheduleDraftSchema } from "../agents/schedule-agent.js";
import { formatLocalDate } from "../../domain/journal.js";
import { nowIso } from "../../utils/time.js";

/* ── Schemas ─────────────────────────────────────────────────────────── */

const InputSchema = z.object({
  vaultPath: z.string(),
  /**
   * 目标日期 YYYY-MM-DD；缺省生成今天的日程。CLI `apo schedule <date>` 透传
   * 进来，Studio 直接触发时可以不传（接线必需的最小改动，生成逻辑本身没动）。
   */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const OutputSchema = z.object({
  date: z.string(),
  blocks: z.array(z.object({
    start: z.string(),
    end: z.string(),
    activity: z.string(),
    priority: z.enum(["high", "medium", "low"]),
    project: z.string().optional(),
  })),
  notes: z.string(),
  markdown: z.string(),
});

/* ── Steps ───────────────────────────────────────────────────────────── */

const resolveVaultStep = createStep({
  id: "resolve-vault",
  inputSchema: InputSchema,
  outputSchema: InputSchema,
  execute: async ({ inputData }) => ({
    vaultPath: await resolveExistingDirectory(inputData.vaultPath),
    // date 也要原样透传给下一步：步骤链上一步的输出就是下一步的输入。
    date: inputData.date,
  }),
});

const generateScheduleStep = createStep({
  id: "generate-schedule",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async ({ inputData }) => {
    // 指定日期时以它为准（含星期/周末判断），否则沿用“今天”。
    const today = inputData.date ?? formatLocalDate();
    const dayOfWeek = inputData.date
      ? new Date(`${inputData.date}T00:00:00`).getDay()
      : new Date().getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const weekdayLabel = ["日", "一", "二", "三", "四", "五", "六"][dayOfWeek];

    const prompt = [
      `今天是 ${today}，星期${weekdayLabel}${isWeekend ? "（周末）" : "（工作日）"}。`,
      "",
      "请为 Yuy 生成今天的日程表。",
      isWeekend
        ? "今天周末，9:00-18:00 用个人学习和项目安排替代实习。"
        : "今天工作日，9:00-18:00 是 Ai好记实习时间。",
      "",
      "输出结构化的日程 blocks，每个 block 包含 start/end/activity/priority/project。",
    ].join("\n");

    const result = await scheduleAgent.generate(prompt, {
      maxSteps: 1,
      toolChoice: "none",
      structuredOutput: { schema: ScheduleDraftSchema, jsonPromptInjection: "system" },
    });

    if (!result.object) {
      throw new Error(`Schedule agent returned no structured output (finishReason=${result.finishReason}).`);
    }

    const draft = ScheduleDraftSchema.parse(result.object);
    const generatedAt = nowIso();

    // Persist to vault。落盘日期钉死为请求的日期（缺省=今天），保证文件路径
    // 与调用方期望一致，不随模型输出漂移。
    await saveSchedule(inputData.vaultPath, { ...draft, date: today, generatedAt });

    return {
      date: today,
      blocks: draft.blocks,
      notes: draft.notes,
      markdown: result.text ?? "",
    };
  },
});

/* ── Workflow ────────────────────────────────────────────────────────── */

/**
 * Generate today's daily schedule and persist it to `<vault>/schedule/<date>.md`.
 * Triggered by the morning cron (Hermes) — the output is the schedule text that
 * gets delivered to Yuy.
 */
export const dailyPlanWorkflow = createWorkflow({
  id: "daily-plan",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
})
  .then(resolveVaultStep)
  .then(generateScheduleStep)
  .commit();
