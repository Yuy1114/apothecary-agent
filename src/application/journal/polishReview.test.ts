import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { polishReview } from "./polishReview.js";
import { listProposals } from "../../vault/proposalStore.js";
import type { NotePolisher } from "../ports/notePolisher.js";

const dirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const NOTE = [
  "---",
  'title: "2026-07-17 日记"',
  "type: journal",
  "---",
  "",
  "# 2026-07-17 日记",
  "",
  "## 计划",
  "",
  "- [x] 09:00 处理 inbox",
  "",
  "## 日志",
  "",
  "上午整理了 JS 笔记。",
  "",
  "## 复盘",
  "",
  "今天还行。",
  "",
].join("\n");

async function setup(noteContent = NOTE) {
  const root = await mkdtemp(path.join(tmpdir(), "apothecary-polishreview-"));
  dirs.push(root);
  const vaultPath = path.join(root, "vault");
  const home = path.join(root, "home");
  await mkdir(path.join(vaultPath, "journal/daily"), { recursive: true });
  await mkdir(home, { recursive: true });
  vi.stubEnv("APOTHECARY_HOME", home);
  await writeFile(path.join(vaultPath, "journal/daily/2026-07-17.md"), noteContent, "utf8");
  return { vaultPath, home };
}

const capturing = (body: string) => {
  const inputs: Array<Parameters<NotePolisher["polish"]>[0]> = [];
  const polisher: NotePolisher = {
    polish: async (input) => {
      inputs.push(input);
      return { body, addTags: [], changeSummary: "扩写了复盘" };
    },
  };
  return { polisher, inputs };
};

describe("polishReview", () => {
  it("polishes only the 复盘 section and lands as an edit proposal", async () => {
    const { vaultPath, home } = await setup();
    const { polisher, inputs } = capturing("今天完成了 inbox 清理，把 JS 笔记归位到 notes/，明天继续复盘流程。");
    const result = await polishReview({ vaultPath, cadence: "daily", key: "2026-07-17", mode: "expand" }, polisher);

    expect(inputs[0].noteBody).toBe("今天还行。");
    expect(inputs[0].modes).toEqual(["expand"]);
    const proposals = await listProposals(home);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].id).toBe(result.proposalId);
    expect(proposals[0].title).toBe("润色复盘：2026-07-17");
    const suggested = (proposals[0].payload as { suggestedContent: string }).suggestedContent;
    // Everything outside 复盘 is carried byte-for-byte.
    expect(suggested).toContain("- [x] 09:00 处理 inbox");
    expect(suggested).toContain("上午整理了 JS 笔记。");
    expect(suggested).toContain("## 复盘\n\n今天完成了 inbox 清理");
    expect(suggested).not.toContain("今天还行。");
  });

  it("expand feeds the digest and 日志 as grounding excerpts when present", async () => {
    const { vaultPath } = await setup();
    await mkdir(path.join(vaultPath, "journal/digests/daily"), { recursive: true });
    await writeFile(path.join(vaultPath, "journal/digests/daily/2026-07-17.md"), "## 摘要\n整理了 JS。\n", "utf8");
    const { polisher, inputs } = capturing("扩写后的复盘内容。");
    await polishReview({ vaultPath, cadence: "daily", key: "2026-07-17", mode: "expand" }, polisher);

    const paths = inputs[0].relatedExcerpts.map((e) => e.path);
    expect(paths).toEqual(["journal/digests/daily/2026-07-17.md", "journal/daily/2026-07-17.md#日志"]);
  });

  it("condense passes no excerpts and may shrink the body", async () => {
    const long = NOTE.replace("今天还行。", "废话很多。".repeat(100));
    const { vaultPath } = await setup(long);
    const { polisher, inputs } = capturing("一句话总结。");
    const result = await polishReview({ vaultPath, cadence: "daily", key: "2026-07-17", mode: "condense" }, polisher);
    expect(inputs[0].relatedExcerpts).toEqual([]);
    expect(result.changeSummary).toBe("扩写了复盘");
  });

  it("rejects an empty 复盘 before calling the LLM", async () => {
    const { vaultPath } = await setup(NOTE.replace("今天还行。", ""));
    const { polisher, inputs } = capturing("x");
    await expect(
      polishReview({ vaultPath, cadence: "daily", key: "2026-07-17", mode: "expand" }, polisher),
    ).rejects.toThrow("review_empty");
    expect(inputs).toHaveLength(0);
  });

  it("propagates the draft guard (empty polish body)", async () => {
    const { vaultPath } = await setup();
    const { polisher } = capturing("   ");
    await expect(
      polishReview({ vaultPath, cadence: "daily", key: "2026-07-17", mode: "condense" }, polisher),
    ).rejects.toThrow("polish_rejected:empty_body");
  });
});
