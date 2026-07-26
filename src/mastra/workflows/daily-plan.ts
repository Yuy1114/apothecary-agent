import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { saveSchedule } from "../../application/schedule/scheduleStore.js";
import { scheduleAgent, ScheduleDraftSchema } from "../agents/schedule-agent.js";
import { formatLocalDate } from "../../domain/journal.js";
import { nowIso } from "../../utils/time.js";

/* ── Schemas ─────────────────────────────────────────────────────────── */

const InputSchema = z.object({ vaultPath: z.string() });

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
  }),
});

const generateScheduleStep = createStep({
  id: "generate-schedule",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async ({ inputData }) => {
    const today = formatLocalDate();
    const dayOfWeek = new Date().getDay();
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

    // Persist to vault
    await saveSchedule(inputData.vaultPath, { ...draft, generatedAt });

    return {
      date: draft.date,
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
