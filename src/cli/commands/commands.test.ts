import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { daysSinceLastReview, journalCommand, proposalsListCommand, proposalsShowCommand } from "./read.js";
import { captureCommand, captureTitle, parsePolishModes } from "./propose.js";
import { listProposals } from "../../vault/proposalStore.js";

const dirs: string[] = [];
const originalHome = process.env.APOTHECARY_HOME;

afterEach(async () => {
  process.env.APOTHECARY_HOME = originalHome;
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
