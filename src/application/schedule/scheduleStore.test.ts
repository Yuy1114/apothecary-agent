import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  saveSchedule,
  loadSchedule,
  listRecentScheduleDates,
} from "./scheduleStore.js";
import type { DailySchedule } from "../../domain/schedule.js";

const sampleSchedule: DailySchedule = {
  date: "2026-07-23",
  blocks: [
    { start: "07:30", end: "08:00", activity: "起床 + 早餐", priority: "low" },
    { start: "09:00", end: "18:00", activity: "实习", priority: "high", project: "aihaoji" },
    { start: "19:00", end: "21:00", activity: "开发", priority: "medium", project: "apothecary-agent" },
  ],
  notes: "",
  generatedAt: "2026-07-23T00:00:00.000Z",
};

describe("scheduleStore", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = path.join(os.tmpdir(), `apothecary-schedule-test-${Date.now()}`);
    await fs.mkdir(vaultPath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(vaultPath, { recursive: true, force: true });
  });

  it("saves and loads a schedule", async () => {
    await saveSchedule(vaultPath, sampleSchedule);
    const loaded = await loadSchedule(vaultPath, "2026-07-23");
    expect(loaded).not.toBeNull();
    expect(loaded!.date).toBe("2026-07-23");
    expect(loaded!.blocks).toHaveLength(3);
    expect(loaded!.blocks[0].activity).toBe("起床 + 早餐");
  });

  it("returns null for a non-existent schedule", async () => {
    const loaded = await loadSchedule(vaultPath, "2099-01-01");
    expect(loaded).toBeNull();
  });

  it("overwrites an existing schedule", async () => {
    await saveSchedule(vaultPath, sampleSchedule);
    const updated = { ...sampleSchedule, notes: "updated notes" };
    await saveSchedule(vaultPath, updated);
    const loaded = await loadSchedule(vaultPath, "2026-07-23");
    expect(loaded!.notes).toBe("updated notes");
  });

  it("lists recent schedule dates", async () => {
    const dates = ["2026-07-21", "2026-07-22", "2026-07-23"];
    for (const date of dates) {
      await saveSchedule(vaultPath, { ...sampleSchedule, date });
    }
    const recent = await listRecentScheduleDates(vaultPath);
    expect(recent).toEqual(["2026-07-23", "2026-07-22", "2026-07-21"]);
  });

  it("handles missing schedule directory gracefully", async () => {
    const recent = await listRecentScheduleDates(vaultPath);
    expect(recent).toEqual([]);
  });
});
