import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { addPlanItem, instantiatePeriod, readPeriod, togglePlanItem } from "./journalStore.js";
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
  const root = await mkdtemp(path.join(tmpdir(), "apothecary-journal-"));
  dirs.push(root);
  const vaultPath = path.join(root, "vault");
  const home = path.join(root, "home");
  await mkdir(vaultPath, { recursive: true });
  vi.stubEnv("APOTHECARY_HOME", home);
  setSearchIndex({ ...nullSearchIndex, reindexFile: async (rel) => { reindexed.push(rel); return { added: 1 }; } });
  await initOperationLedger(`file:${path.join(root, "operations.db")}`);
  return { vaultPath, home };
}

const planSection = (content: string) => /## 计划\n([\s\S]*?)\n## /.exec(content)?.[1] ?? "";

describe("journalStore", () => {
  it("instantiates a day from the user template with vars substituted", async () => {
    const { vaultPath, home } = await setup();
    await mkdir(path.join(vaultPath, "journal/_templates"), { recursive: true });
    await writeFile(
      path.join(vaultPath, "journal/_templates/daily.md"),
      "# {{title}}\n\n## 计划\n\n- [ ] 09:30 站会 {{date}}\n\n## 复盘\n",
      "utf8",
    );

    const { created, note } = await instantiatePeriod(vaultPath, "daily", "2026-07-20");
    expect(created).toBe(true);
    expect(note.relPath).toBe("journal/daily/2026-07-20.md");
    const content = await readFile(path.join(vaultPath, note.relPath), "utf8");
    expect(content).toBe("# 2026-07-20 日记\n\n## 计划\n\n- [ ] 09:30 站会 2026-07-20\n\n## 复盘\n");
    expect(note.items).toHaveLength(1);

    expect(reindexed).toEqual(["journal/daily/2026-07-20.md"]);
    const snapshot = await loadSnapshot(home);
    expect(snapshot.files["journal/daily/2026-07-20.md"]).toBeDefined();
    const ops = await listOperations();
    expect(ops[0]).toMatchObject({ type: "capture", source: "journal" });
  });

  it("falls back to built-in templates per cadence — sections, no items", async () => {
    const { vaultPath } = await setup();
    const { note: weekly } = await instantiatePeriod(vaultPath, "weekly", "2026-W29");
    expect(weekly.relPath).toBe("journal/weekly/2026-W29.md");
    expect(weekly.items).toHaveLength(0);
    expect(weekly.reviewFilled).toBe(false);
    expect(weekly.content).toContain("start: 2026-07-13");

    const day = await readPeriod(vaultPath, "daily", "2026-07-21");
    expect(day.exists).toBe(false);
  });

  it("does not rewrite an existing period note", async () => {
    const { vaultPath } = await setup();
    await instantiatePeriod(vaultPath, "daily", "2026-07-20");
    reindexed.length = 0;
    const second = await instantiatePeriod(vaultPath, "daily", "2026-07-20");
    expect(second.created).toBe(false);
    expect(reindexed).toHaveLength(0);
  });

  it("toggles a plan line on disk, preserves other lines, and records an edit op", async () => {
    const { vaultPath } = await setup();
    const relPath = "journal/daily/2026-07-20.md";
    const original = "# 头部\n\n## 计划\n\n- [ ] 09:30 站会\n- [ ] 14:00 复习\n\n## 复盘\n尾行\n";
    await mkdir(path.join(vaultPath, "journal/daily"), { recursive: true });
    await writeFile(path.join(vaultPath, relPath), original, "utf8");

    const note = await togglePlanItem(vaultPath, "daily", "2026-07-20", 5);
    expect(note.items.find((i) => i.line === 5)?.done).toBe(true);
    const content = await readFile(path.join(vaultPath, relPath), "utf8");
    expect(content).toBe("# 头部\n\n## 计划\n\n- [x] 09:30 站会\n- [ ] 14:00 复习\n\n## 复盘\n尾行\n");
    const ops = await listOperations();
    expect(ops[0]).toMatchObject({ type: "edit", source: "journal", rationale: "完成：站会" });

    const back = await togglePlanItem(vaultPath, "daily", "2026-07-20", 5);
    expect(back.items.find((i) => i.line === 5)?.done).toBe(false);
    expect(await readFile(path.join(vaultPath, relPath), "utf8")).toBe(original);
  });

  it("relocates a stale menu item by key after lines shifted", async () => {
    const { vaultPath } = await setup();
    const relPath = "journal/daily/2026-07-20.md";
    await mkdir(path.join(vaultPath, "journal/daily"), { recursive: true });
    // Menu was built when 站会 sat on line 2; a line was inserted above since.
    await writeFile(path.join(vaultPath, relPath), "## 计划\n- [ ] 08:00 新条目\n- [ ] 09:30 站会\n", "utf8");

    const note = await togglePlanItem(vaultPath, "daily", "2026-07-20", 2, "- [ ] 09:30 站会");
    expect(note.items.find((i) => i.title === "站会")?.done).toBe(true);
    expect(note.items.find((i) => i.title === "新条目")?.done).toBe(false);
  });

  it("writes nothing when the expected item disappeared", async () => {
    const { vaultPath } = await setup();
    const relPath = "journal/daily/2026-07-20.md";
    await mkdir(path.join(vaultPath, "journal/daily"), { recursive: true });
    await writeFile(path.join(vaultPath, relPath), "## 计划\n- [ ] 10:00 只剩这条\n", "utf8");

    const note = await togglePlanItem(vaultPath, "daily", "2026-07-20", 2, "- [ ] 09:30 已被删除的条目");
    expect(note.items.every((i) => !i.done)).toBe(true);
    const ops = await listOperations();
    expect(ops).toHaveLength(0);
  });

  it("addPlanItem to a period instantiates it first and appends into 计划", async () => {
    const { vaultPath } = await setup();
    const result = await addPlanItem(
      vaultPath,
      { kind: "period", cadence: "daily", key: "2026-07-22" },
      { title: "面试复盘", time: "14:00", endTime: "15:00" },
    );
    expect(result.note?.items.map((i) => i.title)).toEqual(["面试复盘"]);
    const content = await readFile(path.join(vaultPath, "journal/daily/2026-07-22.md"), "utf8");
    expect(planSection(content)).toContain("- [ ] 14:00-15:00 面试复盘");
    const ops = await listOperations();
    expect(ops[0]).toMatchObject({ type: "edit", source: "journal", rationale: "添加计划：面试复盘" });
  });

  it("addPlanItem to a template creates the skeleton and keeps placeholders", async () => {
    const { vaultPath } = await setup();
    await addPlanItem(vaultPath, { kind: "template", cadence: "weekly" }, { title: "写周报" });
    const template = await readFile(path.join(vaultPath, "journal/_templates/weekly.md"), "utf8");
    expect(template).toContain("- [ ] 写周报");
    expect(template).toContain("{{week}}"); // 占位符保留，实例化时才替换

    // Recurrence materializes: a fresh week instantiates with the item.
    const { note } = await instantiatePeriod(vaultPath, "weekly", "2026-W30");
    expect(note.items.map((i) => i.title)).toEqual(["写周报"]);
    expect(note.content).toContain("week: 2026-W30");
  });

  it("rejects malformed keys and empty titles before any path is built", async () => {
    const { vaultPath } = await setup();
    await expect(instantiatePeriod(vaultPath, "daily", "../evil")).rejects.toThrow("invalid_journal_key");
    await expect(togglePlanItem(vaultPath, "daily", "2026-7-1", 1)).rejects.toThrow("invalid_journal_key");
    await expect(instantiatePeriod(vaultPath, "weekly", "2026-07-20")).rejects.toThrow("invalid_journal_key");
    await expect(
      addPlanItem(vaultPath, { kind: "period", cadence: "daily", key: "2026-07-20" }, { title: "  " }),
    ).rejects.toThrow("empty_plan_title");
  });
});
