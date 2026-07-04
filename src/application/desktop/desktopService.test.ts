import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DesktopService } from "./desktopService.js";
import { createProposal } from "../../vault/proposalStore.js";
import { enqueueChange, setChangeLogClient } from "../../vault/changeLog.js";
import { setOperationLedgerClient } from "../../vault/operationLedger.js";

const dirs: string[] = [];
afterEach(async () => {
  setChangeLogClient(null);
  setOperationLedgerClient(null);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "apothecary-desktop-service-"));
  dirs.push(root);
  const vaultPath = path.join(root, "vault");
  const projectRoot = path.join(root, "project");
  await mkdir(path.join(vaultPath, "inbox"), { recursive: true });
  await writeFile(path.join(vaultPath, "inbox", "idea.txt"), "Redis idea", "utf8");
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
    await expect(service.readTextFile("inbox/idea.txt")).resolves.toMatchObject({ content: "Redis idea" });
    expect(await service.changes()).toHaveLength(1);
    expect(await service.proposals("proposed")).toHaveLength(1);
    await expect(service.dashboard()).resolves.toMatchObject({
      pendingChanges: 1,
      pendingProposals: 1,
    });
  });

  it("only reads inbox files through the inbox detail endpoint", async () => {
    const { service } = await setup();
    await expect(service.readInboxFile("inbox/idea.txt")).resolves.toMatchObject({ content: "Redis idea" });
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
