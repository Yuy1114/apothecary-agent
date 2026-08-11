import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  daysSinceLastReview,
  dayCommand,
  journalCommand,
  proposalsListCommand,
  proposalsShowCommand,
  relatedCommand,
} from "./read.js";
import { captureCommand, captureTitle, parsePolishModes } from "./propose.js";
import { listProposals } from "../../vault/proposalStore.js";
import { queryVault } from "../../mastra/tools/rag.js";

// read.ts 对 mastra 的动态 import 在这里打桩：单测不拉起真实向量库，也不触发
// embedding 网络调用（queryVault 的 embed 有 20s 超时，不能出现在测试里）。
vi.mock("../runtime.js", () => ({
  installCliPorts: vi.fn(async () => null as never),
}));

vi.mock("../../mastra/tools/rag.js", () => ({
  queryVault: vi.fn(),
}));

const dirs: string[] = [];
const originalHome = process.env.APOTHECARY_HOME;
const originalType4Me = process.env.TYPE4ME_HISTORY_DB;

afterEach(async () => {
  process.env.APOTHECARY_HOME = originalHome;
  process.env.TYPE4ME_HISTORY_DB = originalType4Me;
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function freshWorkspace(): Promise<{ vault: string; home: string }> {
  const vault = await mkdtemp(path.join(tmpdir(), "apothecary-cmd-vault-"));
  const home = await mkdtemp(path.join(tmpdir(), "apothecary-cmd-home-"));
  dirs.push(vault, home);
  await mkdir(path.join(vault, "journal", "daily"), { recursive: true });
  process.env.APOTHECARY_HOME = home;
  return { vault, home };
}

describe("captureTitle", () => {
  it("uses the first non-empty line, stripped of heading markers", () => {
    expect(captureTitle("# 用 WAL 解决多进程读\n\n正文")).toBe("用 WAL 解决多进程读");
    expect(captureTitle("\n\n  第二行才是内容  ")).toBe("第二行才是内容");
  });

  it("truncates a long first line", () => {
    expect(captureTitle("x".repeat(60))).toBe(`${"x".repeat(40)}…`);
  });

  it("falls back rather than producing an empty title", () => {
    // createProposal requires a non-empty title, so this must never return "".
    expect(captureTitle("   \n  \n")).toBe("捕获的内容");
  });
});

describe("captureCommand", () => {
  it("records a proposal and writes nothing to the vault", async () => {
    const { vault, home } = await freshWorkspace();
    const result = await captureCommand("Redis 过期策略：惰性 + 定期", { topic: "notes/redis" });

    const proposals = await listProposals(home, { status: "proposed" });
    expect(proposals).toHaveLength(1);
    expect(proposals[0].type).toBe("capture");
    expect(proposals[0].payload).toMatchObject({
      content: "Redis 过期策略：惰性 + 定期",
      topic: "notes/redis",
    });
    expect(result.json).toMatchObject({ proposalId: proposals[0].id });
    // The consent gate: a capture drafts a proposal, it does not write a note.
    expect(await readdir(vault)).toEqual(["journal"]);
  });

  it("refuses empty content", async () => {
    await freshWorkspace();
    await expect(captureCommand("   ")).rejects.toThrow(/非空/);
  });
});

describe("parsePolishModes", () => {
  it("accepts the known modes", () => {
    expect(parsePolishModes(["expand", "tags"])).toEqual(["expand", "tags"]);
  });

  it("rejects an unknown mode and an empty list", () => {
    expect(() => parsePolishModes(["shorten"])).toThrow(/未知的 --mode/);
    expect(() => parsePolishModes([])).toThrow(/至少一个/);
  });
});

describe("relatedCommand", () => {
  it("returns an empty list without failing when nothing matches", async () => {
    await freshWorkspace();
    vi.mocked(queryVault).mockResolvedValueOnce([]);
    const result = await relatedCommand(path.join(tmpdir(), "dummy-vault"), "排课");
    expect(result.json).toEqual({ topic: "排课", results: [] });
    expect(result.text).toContain("药柜里没有找到跟「排课」相关的笔记");
  });

  it("keeps only source/title/supersededBy — content never leaks", async () => {
    await freshWorkspace();
    vi.mocked(queryVault).mockResolvedValueOnce([
      { source: "notes/排课.md", title: "排课方案", content: "内文", supersededBy: "notes/排课v2.md" },
      { source: "notes/其他.md", title: "其他", content: "另一段内文" },
    ]);
    const result = await relatedCommand(path.join(tmpdir(), "dummy-vault"), "排课");
    expect(result.json).toMatchObject({
      results: [
        { source: "notes/排课.md", title: "排课方案", supersededBy: "notes/排课v2.md" },
        { source: "notes/其他.md", title: "其他" },
      ],
    });
    const serialized = JSON.stringify(result.json);
    expect(serialized).not.toContain("内文");
    expect(serialized).not.toContain("content");
  });
});

describe("dayCommand", () => {
  it("degrades honestly when Type4Me is missing and the day has no diary or proposals", async () => {
    const { vault } = await freshWorkspace();
    const missing = path.join(tmpdir(), `type4me-missing-${Date.now()}.db`);
    dirs.push(missing);
    process.env.TYPE4ME_HISTORY_DB = missing;

    const result = await dayCommand(vault, "2026-08-11");
    expect(result.json).toMatchObject({
      date: "2026-08-11",
      journal: { exists: false },
      voice: { available: false },
      proposals: { count: 0, proposals: [] },
    });
    expect(result.text).toContain("当日无日记");
    expect(result.text).toContain("语音记录不可用");
    expect(result.text).toContain("当日无提案记录");
    expect(result.exitCode).toBeUndefined();
  });

  it("assembles diary excerpt, local-time voice records and that day's proposals", async () => {
    const { vault } = await freshWorkspace();
    const dbPath = path.join(tmpdir(), `type4me-${Date.now()}.db`);
    dirs.push(dbPath);
    process.env.TYPE4ME_HISTORY_DB = dbPath;

    // 造一个最小 Type4Me 库：created_at 是 UTC，当天两条、前一天一条（不该出现）。
    const { createClient } = await import("@libsql/client");
    const db = createClient({ url: `file:${dbPath}` });
    await db.execute(
      `CREATE TABLE recognition_history (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, raw_text TEXT NOT NULL)`,
    );
    await db.execute({
      sql: "INSERT INTO recognition_history (id, created_at, raw_text) VALUES (?, ?, ?)",
      args: ["a", "2026-08-11T02:40:05Z", "第一句"],
    });
    await db.execute({
      sql: "INSERT INTO recognition_history (id, created_at, raw_text) VALUES (?, ?, ?)",
      args: ["b", "2026-08-11T00:05:00Z", "第二句"],
    });
    await db.execute({
      sql: "INSERT INTO recognition_history (id, created_at, raw_text) VALUES (?, ?, ?)",
      args: ["c", "2026-08-10T23:00:00Z", "不该出现"],
    });
    db.close();

    // 当天日记：journal/YYYY/YYYY-MM-DD Daily Log.md
    await mkdir(path.join(vault, "journal", "2026"), { recursive: true });
    await writeFile(
      path.join(vault, "journal", "2026", "2026-08-11 Daily Log.md"),
      "# 📅 Daily Log — 2026-08-11\n\n## 🎯 今日推进主线\n\n- 排课定稿\n",
      "utf8",
    );

    // 当天/前一天的提案（createdAt 是 UTC ISO，按日期前缀过滤）。
    const home = process.env.APOTHECARY_HOME as string;
    await mkdir(path.join(home, "proposals"), { recursive: true });
    const proposal = (id: string, createdAt: string) => ({
      id,
      type: "capture" as const,
      status: "proposed" as const,
      title: "当天提案",
      rationale: "测试",
      payload: { content: "测试内容" },
      targetFiles: [],
      createdAt,
    });
    await writeFile(
      path.join(home, "proposals", "prop-day.json"),
      JSON.stringify(proposal("prop-day", "2026-08-11T02:00:00.000Z"), null, 2),
      "utf8",
    );
    await writeFile(
      path.join(home, "proposals", "prop-yesterday.json"),
      JSON.stringify(proposal("prop-yesterday", "2026-08-10T02:00:00.000Z"), null, 2),
      "utf8",
    );

    const result = await dayCommand(vault, "2026-08-11");
    expect(result.json).toMatchObject({
      date: "2026-08-11",
      journal: { exists: true, relPath: "journal/2026/2026-08-11 Daily Log.md" },
      voice: { available: true, count: 2 },
      proposals: { count: 1 },
    });
    const json = result.json as {
      voice: { records: Array<{ time: string; text: string }> };
      proposals: { proposals: Array<{ id: string }> };
    };
    // UTC → 本地 +8：02:40Z → 10:40，00:05Z → 08:05；按 created_at 升序。
    expect(json.voice.records.map((r) => r.time)).toEqual(["08:05", "10:40"]);
    expect(json.voice.records.map((r) => r.text)).toEqual(["第二句", "第一句"]);
    expect(json.proposals.proposals.map((p) => p.id)).toEqual(["prop-day"]);
    expect(result.text).toContain("2026-08-11 全记录回看");
    expect(result.text).toContain("【日记】journal/2026/2026-08-11 Daily Log.md");
    expect(result.text).toContain("当日 2 条");
  });
});

describe("proposalsListCommand", () => {
  it("says so plainly when nothing is pending", async () => {
    await freshWorkspace();
    const result = await proposalsListCommand();
    expect(result.json).toMatchObject({ pending: 0 });
    expect(result.text).toContain("没有待审提案");
  });

  it("reports the full pending count even when limited", async () => {
    await freshWorkspace();
    await captureCommand("一");
    await captureCommand("二");
    await captureCommand("三");

    const result = await proposalsListCommand(2);
    expect(result.json).toMatchObject({ pending: 3, shown: 2 });
  });
});

describe("proposalsShowCommand", () => {
  it("exits non-zero for an unknown id instead of pretending it succeeded", async () => {
    await freshWorkspace();
    const result = await proposalsShowCommand("prop-nope");
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({ found: false });
  });
});

describe("journalCommand", () => {
  it("reports plan items and review state for an existing note", async () => {
    const { vault } = await freshWorkspace();
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    await writeFile(
      path.join(vault, "journal", "daily", `${key}.md`),
      "# 今天\n\n## 计划\n\n- [x] 09:30 站会\n- [ ] 写周报\n\n## 复盘\n\n",
      "utf8",
    );

    const result = await journalCommand(vault, "today");
    expect(result.json).toMatchObject({ key, exists: true, reviewFilled: false });
    expect(result.text).toContain("复盘未写");
  });

  it("does not invent a note that is not there", async () => {
    const { vault } = await freshWorkspace();
    const result = await journalCommand(vault, "yesterday");
    expect(result.json).toMatchObject({ exists: false });
    expect(result.text).toContain("还没有日记");
  });
});

describe("daysSinceLastReview", () => {
  const today = new Date(2026, 7, 1); // 2026-08-01 local

  it("counts whole days back to the last day with reviews", () => {
    expect(daysSinceLastReview([["2026-07-29", 12], ["2026-07-30", 0]], today)).toBe(3);
  });

  it("returns 0 when today has reviews", () => {
    expect(daysSinceLastReview([["2026-08-01", 5]], today)).toBe(0);
  });

  it("returns null when Anki has no review history at all", () => {
    expect(daysSinceLastReview([], today)).toBeNull();
    expect(daysSinceLastReview([["2026-07-30", 0]], today)).toBeNull();
  });
});
