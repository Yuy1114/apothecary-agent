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
    const service = new DesktopService({
      vaultPath: path.join(root, "vault"),
      projectRoot: path.join(root, "project"),
      deps: {
        chat: async () => "fallback",
        streamChat: async (_messages, emit) => {
          emit({ type: "tool_started", toolCallId: "one", toolName: "scanVault" });
          emit({ type: "text_delta", text: "完成" });
        },
      },
    });
    await service.initialize();

    await service.streamChat([{ role: "user", content: "整理 inbox" }], (event) => events.push(event));

    expect(events).toEqual([
      { type: "tool_started", toolCallId: "one", toolName: "scanVault" },
      { type: "text_delta", text: "完成" },
    ]);
  });
});
