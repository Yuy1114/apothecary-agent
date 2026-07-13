import type { IpcMain } from "electron";
import type { DesktopService } from "../application/desktop/desktopService.js";
import type { AgentRunEvent } from "../application/desktop/runEvents.js";
import {
  CancelRunInputSchema,
  ChatInputSchema,
  ResolveApprovalInputSchema,
  DesktopChannel,
  ListProposalsInputSchema,
  ReadInboxInputSchema,
  ResolveChangesInputSchema,
  VaultFolderInputSchema,
  ResolveProposalInputSchema,
  ProposalDiffInputSchema,
  PolishNoteInputSchema,
  RecentActivityInputSchema,
  ResumeRunInputSchema,
  StartRunInputSchema,
  ThreadIdInputSchema,
  CreateThreadInputSchema,
} from "./contracts.js";

export function registerDesktopIpc(ipcMain: IpcMain, service: DesktopService): void {
  ipcMain.handle(DesktopChannel.dashboard, () => service.dashboard());
  ipcMain.handle(DesktopChannel.chat, (_event, input) => {
    const { messages } = ChatInputSchema.parse(input);
    return service.chat(messages);
  });
  ipcMain.handle(DesktopChannel.startRun, (ipcEvent, input) => {
    const { runId, messages, threadId } = StartRunInputSchema.parse(input);
    const send = (event: AgentRunEvent) => {
      if (!ipcEvent.sender.isDestroyed()) ipcEvent.sender.send(DesktopChannel.runEvent, { runId, event });
    };
    // Fire-and-forget: terminal state (completed / awaiting_decision / failed) is
    // emitted from within the stream, so the timeline pauses on suspension rather
    // than being force-completed by the handler.
    void (async () => {
      send({ type: "status", phase: "started", label: "Agent Run 已开始" });
      try {
        await service.streamChat(messages, send, runId, threadId);
      } catch (error) {
        send({ type: "failed", message: error instanceof Error ? error.message : "Agent 执行失败" });
      }
    })();
    return { runId };
  });
  ipcMain.handle(DesktopChannel.resumeRun, (ipcEvent, input) => {
    const { runId, proposalId, decision, note } = ResumeRunInputSchema.parse(input);
    const send = (event: AgentRunEvent) => {
      if (!ipcEvent.sender.isDestroyed()) ipcEvent.sender.send(DesktopChannel.runEvent, { runId, event });
    };
    // Applies the decision (approve => resolveProposal) and resumes the run; the
    // continued agent output streams back over runEvent on the same runId.
    return service.resumeRun(runId, proposalId, decision, send, note);
  });
  ipcMain.handle(DesktopChannel.resolveApproval, (ipcEvent, input) => {
    const { runId, toolCallId, decision } = ResolveApprovalInputSchema.parse(input);
    const send = (event: AgentRunEvent) => {
      if (!ipcEvent.sender.isDestroyed()) ipcEvent.sender.send(DesktopChannel.runEvent, { runId, event });
    };
    // Approve => run the gated tool and resume; decline => resume with it skipped.
    // The continued agent output streams back over runEvent on the same runId.
    return service.resolveApproval(runId, toolCallId, decision, send);
  });
  ipcMain.handle(DesktopChannel.cancelRun, (_event, input) => {
    const { runId } = CancelRunInputSchema.parse(input);
    return { canceled: service.cancelRun(runId) };
  });
  ipcMain.handle(DesktopChannel.changes, () => service.changes());
  ipcMain.handle(DesktopChannel.resolveChanges, (_event, input) => {
    const parsed = ResolveChangesInputSchema.parse(input);
    return service.resolveChanges(parsed.ids, parsed.outcome);
  });
  ipcMain.handle(DesktopChannel.sync, () => service.sync());
  ipcMain.handle(DesktopChannel.inbox, () => service.inbox());
  ipcMain.handle(DesktopChannel.vaultTree, () => service.vaultTree());
  ipcMain.handle(DesktopChannel.vaultFolder, (_event, input) => {
    const { scopePath } = VaultFolderInputSchema.parse(input);
    return service.vaultFolder(scopePath);
  });
  ipcMain.handle(DesktopChannel.readInbox, (_event, input) => {
    const { filePath } = ReadInboxInputSchema.parse(input);
    return service.readInboxFile(filePath);
  });
  ipcMain.handle(DesktopChannel.readFile, (_event, input) => {
    const { filePath } = ReadInboxInputSchema.parse(input);
    return service.readTextFile(filePath);
  });
  ipcMain.handle(DesktopChannel.proposals, (_event, input) => {
    const { status } = ListProposalsInputSchema.parse(input ?? {});
    return service.proposals(status);
  });
  ipcMain.handle(DesktopChannel.proposalDiff, (_event, input) => {
    const { id } = ProposalDiffInputSchema.parse(input);
    return service.proposalDiff(id);
  });
  ipcMain.handle(DesktopChannel.resolveProposal, (_event, input) => {
    const parsed = ResolveProposalInputSchema.parse(input);
    return service.resolveProposal(parsed.id, parsed.decision, parsed.note);
  });
  ipcMain.handle(DesktopChannel.polishNote, (_event, input) => {
    const { filePath, modes } = PolishNoteInputSchema.parse(input);
    return service.polishNote(filePath, modes);
  });
  ipcMain.handle(DesktopChannel.notes, () => service.notes());
  ipcMain.handle(DesktopChannel.operations, () => service.operations());
  ipcMain.handle(DesktopChannel.recentActivity, (_event, input) => {
    const { days } = RecentActivityInputSchema.parse(input ?? {});
    return service.recentActivity(days);
  });
  ipcMain.handle(DesktopChannel.knowledge, () => service.knowledge());
  ipcMain.handle(DesktopChannel.diagnostics, () => service.diagnostics());
  ipcMain.handle(DesktopChannel.threads, () => service.threads());
  ipcMain.handle(DesktopChannel.threadMessages, (_event, input) => {
    const { threadId } = ThreadIdInputSchema.parse(input);
    return service.threadMessages(threadId);
  });
  ipcMain.handle(DesktopChannel.createThread, (_event, input) => {
    const { threadId, title } = CreateThreadInputSchema.parse(input);
    return service.createThread(threadId, title);
  });
  ipcMain.handle(DesktopChannel.deleteThread, (_event, input) => {
    const { threadId } = ThreadIdInputSchema.parse(input);
    return service.deleteThread(threadId);
  });
}
