import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { instantiateDay, readDaySchedule, toggleScheduleItem } from "./scheduleStore.js";
import { nullSearchIndex, setSearchIndex } from "../ports/searchIndex.js";
import { initOperationLedger, listOperations, setOperationLedgerClient } from "../../vault/operationLedger.js";
import { loadSnapshot } from "../../vault/syncSnapshot.js";

const dirs: string[] = [];
const reindexed: string[] = [];

afterEach(async () => {
  setOperationLedgerClient(null);
  vi.unstubAllEnvs();
  reindexed.length = 0;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "apothecary-schedule-"));
  dirs.push(root);
  const vaultPath = path.join(root, "vault");
  const home = path.join(root, "home");
  await mkdir(vaultPath, { recursive: true });
  vi.stubEnv("APOTHECARY_HOME", home);
  setSearchIndex({ ...nullSearchIndex, reindexFile: async (rel) => { reindexed.push(rel); return { added: 1 }; } });
  await initOperationLedger(`file:${path.join(root, "operations.db")}`);
  return { vaultPath, home };
}

describe("scheduleStore", () => {
  it("instantiates today from the user template with dates substituted", async () => {
    const { vaultPath, home } = await setup();
    await mkdir(path.join(vaultPath, "areas/schedule"), { recursive: true });
    await writeFile(
      path.join(vaultPath, "areas/schedule/_template.md"),
      "# {{date}} 日程\n\n- [ ] 09:30 站会 {{date}}\n",
      "utf8",
    );

    const result = await instantiateDay(vaultPath, "2026-07-20");
    expect(result).toEqual({ created: true, relPath: "areas/schedule/2026-07-20.md" });
    const content = await readFile(path.join(vaultPath, result.relPath), "utf8");
    expect(content).toBe("# 2026-07-20 日程\n\n- [ ] 09:30 站会 2026-07-20\n");

    expect(reindexed).toEqual(["areas/schedule/2026-07-20.md"]);
    const snapshot = await loadSnapshot(home);
    expect(snapshot.files["areas/schedule/2026-07-20.md"]).toBeDefined();
    const ops = await listOperations();
    expect(ops[0]).toMatchObject({ type: "capture", source: "schedule" });
  });

  it("falls back to the built-in default template with no checklist items", async () => {
    const { vaultPath } = await setup();
    await instantiateDay(vaultPath, "2026-07-21");
    const schedule = await readDaySchedule(vaultPath, "2026-07-21");
    expect(schedule.exists).toBe(true);
    expect(schedule.items).toHaveLength(0);
  });

  it("does not rewrite an existing day note", async () => {
    const { vaultPath } = await setup();
    await instantiateDay(vaultPath, "2026-07-20");
    reindexed.length = 0;
    const second = await instantiateDay(vaultPath, "2026-07-20");
    expect(second.created).toBe(false);
    expect(reindexed).toHaveLength(0);
  });

  it("toggles a line on disk, preserves other lines, and records an edit op", async () => {
    const { vaultPath } = await setup();
    const relPath = "areas/schedule/2026-07-20.md";
    const original = "# 头部\n\n- [ ] 09:30 站会\n- [ ] 14:00 复习\n尾行\n";
    await mkdir(path.join(vaultPath, "areas/schedule"), { recursive: true });
    await writeFile(path.join(vaultPath, relPath), original, "utf8");

    const schedule = await toggleScheduleItem(vaultPath, "2026-07-20", 3);
    expect(schedule.items.find((i) => i.line === 3)?.done).toBe(true);
    const content = await readFile(path.join(vaultPath, relPath), "utf8");
    expect(content).toBe("# 头部\n\n- [x] 09:30 站会\n- [ ] 14:00 复习\n尾行\n");
    const ops = await listOperations();
    expect(ops[0]).toMatchObject({ type: "edit", source: "schedule", rationale: "完成：站会" });

    const back = await toggleScheduleItem(vaultPath, "2026-07-20", 3);
    expect(back.items.find((i) => i.line === 3)?.done).toBe(false);
    expect(await readFile(path.join(vaultPath, relPath), "utf8")).toBe(original);
  });

  it("relocates a stale menu item by key after lines shifted", async () => {
    const { vaultPath } = await setup();
    const relPath = "areas/schedule/2026-07-20.md";
    await mkdir(path.join(vaultPath, "areas/schedule"), { recursive: true });
    // Menu was built when 站会 sat on line 1; a line was inserted above since.
    await writeFile(path.join(vaultPath, relPath), "- [ ] 08:00 新条目\n- [ ] 09:30 站会\n", "utf8");

    const schedule = await toggleScheduleItem(vaultPath, "2026-07-20", 1, "- [ ] 09:30 站会");
    expect(schedule.items.find((i) => i.title === "站会")?.done).toBe(true);
    expect(schedule.items.find((i) => i.title === "新条目")?.done).toBe(false);
  });

  it("writes nothing when the expected item disappeared", async () => {
    const { vaultPath } = await setup();
    const relPath = "areas/schedule/2026-07-20.md";
    await mkdir(path.join(vaultPath, "areas/schedule"), { recursive: true });
    await writeFile(path.join(vaultPath, relPath), "- [ ] 10:00 只剩这条\n", "utf8");

    const schedule = await toggleScheduleItem(vaultPath, "2026-07-20", 1, "- [ ] 09:30 已被删除的条目");
    expect(schedule.items.every((i) => !i.done)).toBe(true);
    const ops = await listOperations();
    expect(ops).toHaveLength(0);
  });

  it("rejects non-date inputs before any path is built", async () => {
    const { vaultPath } = await setup();
    await expect(instantiateDay(vaultPath, "../evil")).rejects.toThrow("invalid_schedule_date");
    await expect(toggleScheduleItem(vaultPath, "2026-7-1", 1)).rejects.toThrow("invalid_schedule_date");
  });
});
