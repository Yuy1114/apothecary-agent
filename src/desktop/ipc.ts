import type { IpcMain } from "electron";
import type { DesktopService } from "../application/desktop/desktopService.js";
import {
  ChatInputSchema,
  DesktopChannel,
  ListProposalsInputSchema,
  ReadInboxInputSchema,
  ResolveChangesInputSchema,
  ResolveProposalInputSchema,
} from "./contracts.js";

export function registerDesktopIpc(ipcMain: IpcMain, service: DesktopService): void {
  ipcMain.handle(DesktopChannel.dashboard, () => service.dashboard());
  ipcMain.handle(DesktopChannel.chat, (_event, input) => {
    const { messages } = ChatInputSchema.parse(input);
    return service.chat(messages);
  });
  ipcMain.handle(DesktopChannel.changes, () => service.changes());
  ipcMain.handle(DesktopChannel.resolveChanges, (_event, input) => {
    const parsed = ResolveChangesInputSchema.parse(input);
    return service.resolveChanges(parsed.ids, parsed.outcome);
  });
  ipcMain.handle(DesktopChannel.sync, () => service.sync());
  ipcMain.handle(DesktopChannel.inbox, () => service.inbox());
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
  ipcMain.handle(DesktopChannel.resolveProposal, (_event, input) => {
    const parsed = ResolveProposalInputSchema.parse(input);
    return service.resolveProposal(parsed.id, parsed.decision, parsed.note);
  });
  ipcMain.handle(DesktopChannel.operations, () => service.operations());
  ipcMain.handle(DesktopChannel.knowledge, () => service.knowledge());
}
