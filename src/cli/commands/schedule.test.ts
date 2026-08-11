import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mastra } from "@mastra/core/mastra";
import { scheduleCommand, parseScheduleDate } from "./schedule.js";
import { formatLocalDate } from "../../domain/journal.js";

// 单测不拉起真实 Mastra：runtime.ts 在这里整体打桩，createCliMastra 返回一个
// 可控的假 workflow run，既不建存储也不触发真实模型调用。
vi.mock("../runtime.js", () => ({
  installCliPorts: vi.fn(async () => null as never),
  createCliMastra: vi.fn(),
}));

import { createCliMastra } from "../runtime.js";

type StartFn = ReturnType<typeof vi.fn>;

/** 造一个假的 workflow run：getWorkflow → createRun → start。 */
function fakeWorkflow() {
  const start = vi.fn() as StartFn;
  const createRun = vi.fn(async () => ({ start }));
  const getWorkflow = vi.fn(() => ({ createRun }));
  vi.mocked(createCliMastra).mockResolvedValue({
    mastra: { getWorkflow } as unknown as Mastra,
  });
  return { getWorkflow, createRun, start };
}

const SUCCESS_RESULT = {
  status: "success",
  result: {
    date: "2026-08-15",
    blocks: [
      { start: "07:30", end: "08:00", activity: "起床 + 早餐", priority: "low" },
      { start: "09:00", end: "18:00", activity: "Ai好记实习", priority: "high", project: "aihaoji" },
    ],
    notes: "下午记得提交周报",
    markdown: "# 2026-08-15 日程",
  },
};

describe("parseScheduleDate", () => {
  it("accepts a well-formed date", () => {
    expect(parseScheduleDate("2026-08-15")).toBe("2026-08-15");
  });

  it("rejects a malformed date", () => {
    expect(() => parseScheduleDate("2026-8-15")).toThrow(/schedule 需要一个 YYYY-MM-DD/);
    expect(() => parseScheduleDate("not-a-date")).toThrow(/schedule 需要一个 YYYY-MM-DD/);
  });

  it("rejects a format-valid but impossible date", () => {
    expect(() => parseScheduleDate("2026-13-99")).toThrow(/schedule 需要一个真实的/);
    expect(() => parseScheduleDate("2026-02-30")).toThrow(/schedule 需要一个真实的/);
  });
});

describe("scheduleCommand", () => {
  let vault: string;

  beforeEach(() => {
    vault = "/tmp/dummy-vault";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs the daily-plan workflow for an explicit date and reports the file path", async () => {
    const { getWorkflow, start } = fakeWorkflow();
    start.mockResolvedValue(SUCCESS_RESULT);

    const result = await scheduleCommand(vault, "2026-08-15");

    expect(getWorkflow).toHaveBeenCalledWith("dailyPlanWorkflow");
    expect(start).toHaveBeenCalledWith({
      inputData: { vaultPath: vault, date: "2026-08-15" },
    });
    expect(result.exitCode).toBeUndefined();
    expect(result.json).toMatchObject({
      ok: true,
      date: "2026-08-15",
      file: "schedule/2026-08-15.md",
      blocks: SUCCESS_RESULT.result.blocks,
      notes: "下午记得提交周报",
    });
    expect(result.text).toContain("已生成 2026-08-15 的日程：schedule/2026-08-15.md");
    expect(result.text).toContain("09:00-18:00　🔴 Ai好记实习　aihaoji");
    expect(result.text).toContain("备注：下午记得提交周报");
  });

  it("defaults to today when no date is given", async () => {
    const { start } = fakeWorkflow();
    start.mockResolvedValue(SUCCESS_RESULT);

    const result = await scheduleCommand(vault);

    expect(start).toHaveBeenCalledWith({
      inputData: { vaultPath: vault, date: formatLocalDate() },
    });
    expect(result.json).toMatchObject({ ok: true });
  });

  it("refuses an invalid date instead of running anything", async () => {
    fakeWorkflow();
    await expect(scheduleCommand(vault, "2026-13-99")).rejects.toThrow(/schedule 需要一个真实的/);
  });

  it("turns a thrown workflow failure into a clear non-zero result instead of crashing", async () => {
    const { start } = fakeWorkflow();
    start.mockRejectedValue(new Error("API key 缺失或无效"));

    const result = await scheduleCommand(vault, "2026-08-15");

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({ ok: false, date: "2026-08-15", error: "API key 缺失或无效" });
    expect(result.text).toContain("生成 2026-08-15 的日程失败：API key 缺失或无效");
  });

  it("surfaces a workflow 'failed' status as a clear error", async () => {
    const { start } = fakeWorkflow();
    start.mockResolvedValue({
      status: "failed",
      input: { vaultPath: vault, date: "2026-08-15" },
      steps: {},
      error: new Error("Schedule agent returned no structured output."),
    });

    const result = await scheduleCommand(vault, "2026-08-15");

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({ ok: false, error: "Schedule agent returned no structured output." });
    expect(result.text).toContain("失败");
  });

  it("digs a human-readable message out of a non-Error rejection (no [object Object])", async () => {
    const { start } = fakeWorkflow();
    // Mastra/模型运行时偶尔会 reject 非 Error 实例的对象，消息藏在 message 字段里。
    start.mockRejectedValue({ message: "rate_limited: DeepSeek API 限流" });

    const result = await scheduleCommand(vault, "2026-08-15");

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({ ok: false, error: "rate_limited: DeepSeek API 限流" });
    expect(result.text).toContain("rate_limited: DeepSeek API 限流");
    expect(result.text).not.toContain("[object Object]");
  });

  it("reports clearly when the workflow is not registered on this mastra", async () => {
    const { getWorkflow } = fakeWorkflow();
    getWorkflow.mockImplementation(() => {
      throw new Error("Workflow dailyPlanWorkflow not found");
    });

    const result = await scheduleCommand(vault, "2026-08-15");

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({ ok: false, error: "Workflow dailyPlanWorkflow not found" });
    expect(result.text).toContain("生成 2026-08-15 的日程失败");
  });

  it("reports clearly when the mastra host itself cannot be built", async () => {
    fakeWorkflow();
    vi.mocked(createCliMastra).mockRejectedValue(new Error("storage init failed"));

    const result = await scheduleCommand(vault, "2026-08-15");

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({ ok: false, error: "storage init failed" });
  });
});
