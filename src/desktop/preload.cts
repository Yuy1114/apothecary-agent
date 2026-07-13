const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const channel = {
  dashboard: "apothecary:dashboard",
  chat: "apothecary:chat",
  startRun: "apothecary:start-run",
  resumeRun: "apothecary:resume-run",
  resolveApproval: "apothecary:resolve-approval",
  cancelRun: "apothecary:cancel-run",
  runEvent: "apothecary:run-event",
  changes: "apothecary:changes",
  resolveChanges: "apothecary:resolve-changes",
  sync: "apothecary:sync",
  inbox: "apothecary:inbox",
  vaultTree: "apothecary:vault-tree",
  vaultFolder: "apothecary:vault-folder",
  readInbox: "apothecary:read-inbox",
  readFile: "apothecary:read-file",
  proposals: "apothecary:proposals",
  proposalDiff: "apothecary:proposal-diff",
  resolveProposal: "apothecary:resolve-proposal",
  polishNote: "apothecary:polish-note",
  notes: "apothecary:notes",
  operations: "apothecary:operations",
  recentActivity: "apothecary:recent-activity",
  knowledge: "apothecary:knowledge",
  diagnostics: "apothecary:diagnostics",
  settingsGet: "apothecary:settings-get",
  settingsSave: "apothecary:settings-save",
  settingsChooseVault: "apothecary:settings-choose-vault",
  appRelaunch: "apothecary:app-relaunch",
  threads: "apothecary:threads",
  threadMessages: "apothecary:thread-messages",
  createThread: "apothecary:create-thread",
  deleteThread: "apothecary:delete-thread",
} as const;

contextBridge.exposeInMainWorld("apothecary", {
  dashboard: () => ipcRenderer.invoke(channel.dashboard),
  chat: (messages: Array<{ role: "user" | "assistant"; content: string }>) =>
    ipcRenderer.invoke(channel.chat, { messages }),
  startRun: (runId: string, messages: Array<{ role: "user" | "assistant"; content: string }>, threadId?: string) =>
    ipcRenderer.invoke(channel.startRun, { runId, messages, threadId }),
  resumeRun: (runId: string, proposalId: string, decision: "approve" | "reject", note?: string) =>
    ipcRenderer.invoke(channel.resumeRun, { runId, proposalId, decision, note }),
  resolveApproval: (runId: string, toolCallId: string, decision: "approve" | "decline") =>
    ipcRenderer.invoke(channel.resolveApproval, { runId, toolCallId, decision }),
  cancelRun: (runId: string) => ipcRenderer.invoke(channel.cancelRun, { runId }),
  onRunEvent: (listener: (message: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: unknown) => listener(message);
    ipcRenderer.on(channel.runEvent, handler);
    return () => ipcRenderer.removeListener(channel.runEvent, handler);
  },
  changes: () => ipcRenderer.invoke(channel.changes),
  resolveChanges: (ids: string[], outcome: "processed" | "dismissed") =>
    ipcRenderer.invoke(channel.resolveChanges, { ids, outcome }),
  sync: () => ipcRenderer.invoke(channel.sync),
  inbox: () => ipcRenderer.invoke(channel.inbox),
  vaultTree: () => ipcRenderer.invoke(channel.vaultTree),
  vaultFolder: (scopePath: string) => ipcRenderer.invoke(channel.vaultFolder, { scopePath }),
  readInbox: (filePath: string) => ipcRenderer.invoke(channel.readInbox, { filePath }),
  readFile: (filePath: string) => ipcRenderer.invoke(channel.readFile, { filePath }),
  proposals: (status?: "proposed" | "applied" | "rejected") =>
    ipcRenderer.invoke(channel.proposals, { status }),
  proposalDiff: (id: string) => ipcRenderer.invoke(channel.proposalDiff, { id }),
  resolveProposal: (id: string, decision: "approve" | "reject", note?: string) =>
    ipcRenderer.invoke(channel.resolveProposal, { id, decision, note }),
  polishNote: (filePath: string, modes: string[]) =>
    ipcRenderer.invoke(channel.polishNote, { filePath, modes }),
  notes: () => ipcRenderer.invoke(channel.notes),
  operations: () => ipcRenderer.invoke(channel.operations),
  recentActivity: (days?: number) => ipcRenderer.invoke(channel.recentActivity, { days }),
  knowledge: () => ipcRenderer.invoke(channel.knowledge),
  diagnostics: () => ipcRenderer.invoke(channel.diagnostics),
  getSettings: () => ipcRenderer.invoke(channel.settingsGet),
  saveSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke(channel.settingsSave, patch),
  chooseVault: () => ipcRenderer.invoke(channel.settingsChooseVault),
  relaunchApp: () => ipcRenderer.invoke(channel.appRelaunch),
  threads: () => ipcRenderer.invoke(channel.threads),
  threadMessages: (threadId: string) => ipcRenderer.invoke(channel.threadMessages, { threadId }),
  createThread: (threadId: string, title?: string) => ipcRenderer.invoke(channel.createThread, { threadId, title }),
  deleteThread: (threadId: string) => ipcRenderer.invoke(channel.deleteThread, { threadId }),
});
