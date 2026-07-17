import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DesktopService } from "./desktopService.js";
import { createProposal } from "../../vault/proposalStore.js";
import { enqueueChange, setChangeLogClient } from "../../vault/changeLog.js";
import { setOperationLedgerClient } from "../../vault/operationLedger.js";
import { nullSearchIndex, setSearchIndex } from "../ports/searchIndex.js";

const dirs: string[] = [];
afterEach(async () => {
  setChangeLogClient(null);
  setOperationLedgerClient(null);
  setSearchIndex({ ...nullSearchIndex });
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "apothecary-desktop-service-"));
  dirs.push(root);
  const vaultPath = path.join(root, "vault");
  const projectRoot = path.join(root, "project");
  vi.stubEnv("APOTHECARY_HOME", vaultPath);
  await mkdir(path.join(vaultPath, "_inbox"), { recursive: true });
  await writeFile(path.join(vaultPath, "_inbox", "idea.txt"), "Redis idea", "utf8");
  // Meta files describing the folder itself must be filtered out of the inbox list.
  await writeFile(path.join(vaultPath, "_inbox", "ABOUT.md"), "# 关于 _inbox", "utf8");
  await writeFile(path.join(vaultPath, "_inbox", "README.md"), "# _inbox 总览", "utf8");
  const service = new DesktopService({
    vaultPath,
    projectRoot,
    deps: { chat: async (messages) => `reply:${messages.at(-1)?.content}` },
  });
  await service.initialize();
  return { service, vaultPath };
}

describe("DesktopService", () => {
  it("provides chat, inbox, changes and proposal data through one boundary", async () => {
    const { service, vaultPath } = await setup();
    await enqueueChange({ path: "inbox/idea.txt", changeType: "created", source: "watcher" });
    await createProposal(vaultPath, {
      type: "move",
      title: "File Redis idea",
      rationale: "belongs in references",
      payload: { from: "inbox/idea.txt", to: "references/idea.txt" },
    });

    await expect(service.chat([{ role: "user", content: "hello" }])).resolves.toBe("reply:hello");
    expect(await service.inbox()).toHaveLength(1);
    await expect(service.readTextFile("_inbox/idea.txt")).resolves.toMatchObject({ content: "Redis idea" });
    expect(await service.changes()).toHaveLength(1);
    expect(await service.proposals("proposed")).toHaveLength(1);
    await expect(service.dashboard()).resolves.toMatchObject({
      pendingChanges: 1,
      pendingProposals: 1,
    });
  });

  it("only reads inbox files through the inbox detail endpoint", async () => {
    const { service } = await setup();
    await expect(service.readInboxFile("_inbox/idea.txt")).resolves.toMatchObject({ content: "Redis idea" });
    await expect(service.readInboxFile("../secret.txt")).rejects.toThrow("not_an_inbox_file");
  });

  it("streams Agent Run events through the desktop boundary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "apothecary-desktop-stream-"));
    dirs.push(root);
    const events: Array<{ type: string }> = [];
    const seenRunId: string[] = [];
    const service = new DesktopService({
      vaultPath: path.join(root, "vault"),
      projectRoot: path.join(root, "project"),
      deps: {
        chat: async () => "fallback",
        streamChat: async (_messages, emit, runId) => {
          seenRunId.push(runId);
          emit({ type: "tool_started", toolCallId: "one", toolName: "scanVault" });
          emit({ type: "text_delta", text: "完成" });
        },
      },
    });
    await service.initialize();

    await service.streamChat([{ role: "user", content: "整理 inbox" }], (event) => events.push(event), "run-1");

    expect(seenRunId).toEqual(["run-1"]);
    expect(events).toEqual([
      { type: "tool_started", toolCallId: "one", toolName: "scanVault" },
      { type: "text_delta", text: "完成" },
    ]);
  });

  it("completes the fallback stream when no streamChat dep is provided", async () => {
    const { service } = await setup();
    const events: Array<{ type: string }> = [];
    await service.streamChat([{ role: "user", content: "hi" }], (event) => events.push(event), "run-2");
    expect(events).toEqual([
      { type: "text_delta", text: "reply:hi" },
      { type: "completed" },
    ]);
  });

  it("forwards a quick ask as a built prompt, isolated from chat deps", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "apothecary-desktop-quickask-"));
    dirs.push(root);
    const prompts: string[] = [];
    const seenRunId: string[] = [];
    const service = new DesktopService({
      vaultPath: path.join(root, "vault"),
      projectRoot: path.join(root, "project"),
      deps: {
        chat: async () => "fallback",
        quickAsk: async (prompt, emit, runId) => {
          prompts.push(prompt);
          seenRunId.push(runId);
          emit({ type: "text_delta", text: "SM-2 是间隔重复算法" });
          emit({ type: "completed" });
        },
      },
    });
    await service.initialize();

    const events: Array<{ type: string }> = [];
    await service.quickAsk(
      {
        runId: "run-qa",
        question: "SM-2 是什么？",
        selection: "SM-2 调度",
        contextText: "## 复习\n采用 SM-2 调度间隔。",
        source: "note",
        sourcePath: "projects/anki.md",
        priorTurns: [{ question: "早先的问题", answer: "早先的回答" }],
      },
      (event) => events.push(event),
    );

    expect(seenRunId).toEqual(["run-qa"]);
    const prompt = prompts[0];
    expect(prompt).toContain("Source: vault note projects/anki.md");
    expect(prompt).toContain("采用 SM-2 调度间隔");
    expect(prompt).toContain("Selected text:");
    expect(prompt).toContain("Q: 早先的问题");
    expect(prompt).toContain("Question: SM-2 是什么？");
    expect(events).toEqual([
      { type: "text_delta", text: "SM-2 是间隔重复算法" },
      { type: "completed" },
    ]);
  });

  it("rejects a quick ask when the dep is not wired", async () => {
    const { service } = await setup();
    await expect(
      service.quickAsk(
        { runId: "run-qa", question: "q", selection: "s", contextText: "c", source: "chat", priorTurns: [] },
        () => {},
      ),
    ).rejects.toThrow("quick_ask_not_available");
  });

  it("a direct ask (empty selection) is grounded by a vault search on the question", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "apothecary-desktop-directask-"));
    dirs.push(root);
    const queries: Array<{ query: string; topK: number }> = [];
    setSearchIndex({
      ...nullSearchIndex,
      queryVault: async (query, topK) => {
        queries.push({ query, topK: topK ?? 0 });
        return [
          { source: "notes/ui-design.md", content: "按钮的可用性原则……", score: 0.9 },
          { source: "notes/ui-design.md", content: "重复来源应被去重", score: 0.85 },
          { source: "notes/old.md", content: "已被取代", score: 0.8, supersededBy: "notes/new.md" },
          { source: "notes/ux-research.md", content: "访谈方法……", score: 0.7 },
        ] as never;
      },
    });
    const prompts: string[] = [];
    const service = new DesktopService({
      vaultPath: path.join(root, "vault"),
      projectRoot: path.join(root, "project"),
      deps: { chat: async () => "", quickAsk: async (prompt) => { prompts.push(prompt); } },
    });
    await service.initialize();

    await service.quickAsk(
      { runId: "run-direct", question: "有没有 ui/ux 相关的内容？", selection: "", contextText: "", source: "chat", priorTurns: [] },
      () => {},
    );

    expect(queries).toEqual([{ query: "有没有 ui/ux 相关的内容？", topK: 6 }]);
    const prompt = prompts[0];
    expect(prompt).toContain("direct ask, no selection");
    expect(prompt).toContain("- notes/ui-design.md:");
    expect(prompt).toContain("- notes/ux-research.md:");
    expect(prompt).not.toContain("notes/old.md"); // superseded hits dropped
    expect(prompt).not.toContain("重复来源"); // duplicate source deduped
    expect(prompt).not.toContain("Selected text:");
  });

  it("a dead search index degrades a direct ask instead of failing it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "apothecary-desktop-directdeg-"));
    dirs.push(root);
    setSearchIndex({
      ...nullSearchIndex,
      queryVault: async () => { throw new Error("embedding down"); },
    });
    const prompts: string[] = [];
    const service = new DesktopService({
      vaultPath: path.join(root, "vault"),
      projectRoot: path.join(root, "project"),
      deps: { chat: async () => "", quickAsk: async (prompt) => { prompts.push(prompt); } },
    });
    await service.initialize();
    await service.quickAsk(
      { runId: "run-deg", question: "问题", selection: "", contextText: "看着的内容", source: "note", sourcePath: "notes/n.md", priorTurns: [] },
      () => {},
    );
    expect(prompts[0]).not.toContain("Related notes");
    expect(prompts[0]).toContain("看着的内容");
  });

  it("resumes a run with the human decision and injects the outcome", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "apothecary-desktop-resume-"));
    dirs.push(root);
    const resumed: Array<{ runId: string; resumeData: unknown }> = [];
    const service = new DesktopService({
      vaultPath: path.join(root, "vault"),
      projectRoot: path.join(root, "project"),
      deps: {
        chat: async () => "fallback",
        resumeRun: async (runId, resumeData, emit) => {
          resumed.push({ runId, resumeData });
          emit({ type: "completed" });
        },
        cancelRun: (runId) => runId === "run-live",
      },
    });
    await service.initialize();

    // Rejecting an (unknown) proposal still resumes the run so it never stays stuck.
    const rejectEvents: Array<{ type: string }> = [];
    await service.resumeRun("run-9", "missing", "reject", (event) => rejectEvents.push(event), "not useful");
    expect(resumed.at(-1)).toEqual({ runId: "run-9", resumeData: { proposalId: "missing", decision: "rejected", note: "not useful" } });
    expect(rejectEvents).toEqual([{ type: "completed" }]);

    // Approving a proposal that cannot be applied resumes with a "failed" outcome.
    const approveResult = await service.resumeRun("run-9", "missing", "approve", () => {});
    expect(approveResult.resolved).toBe(false);
    expect(resumed.at(-1)).toMatchObject({ runId: "run-9", resumeData: { proposalId: "missing", decision: "failed" } });

    expect(service.cancelRun("run-live")).toBe(true);
    expect(service.cancelRun("run-dead")).toBe(false);
  });
});
