const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const channel = {
  dashboard: "apothecary:dashboard",
  chat: "apothecary:chat",
  startRun: "apothecary:start-run",
  resumeRun: "apothecary:resume-run",
  cancelRun: "apothecary:cancel-run",
  runEvent: "apothecary:run-event",
  changes: "apothecary:changes",
  resolveChanges: "apothecary:resolve-changes",
  sync: "apothecary:sync",
  inbox: "apothecary:inbox",
  readInbox: "apothecary:read-inbox",
  readFile: "apothecary:read-file",
  proposals: "apothecary:proposals",
  resolveProposal: "apothecary:resolve-proposal",
  operations: "apothecary:operations",
  knowledge: "apothecary:knowledge",
  diagnostics: "apothecary:diagnostics",
} as const;

contextBridge.exposeInMainWorld("apothecary", {
  dashboard: () => ipcRenderer.invoke(channel.dashboard),
  chat: (messages: Array<{ role: "user" | "assistant"; content: string }>) =>
    ipcRenderer.invoke(channel.chat, { messages }),
  startRun: (runId: string, messages: Array<{ role: "user" | "assistant"; content: string }>) =>
    ipcRenderer.invoke(channel.startRun, { runId, messages }),
  resumeRun: (runId: string, proposalId: string, decision: "approve" | "reject", note?: string) =>
    ipcRenderer.invoke(channel.resumeRun, { runId, proposalId, decision, note }),
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
  readInbox: (filePath: string) => ipcRenderer.invoke(channel.readInbox, { filePath }),
  readFile: (filePath: string) => ipcRenderer.invoke(channel.readFile, { filePath }),
  proposals: (status?: "proposed" | "applied" | "rejected") =>
    ipcRenderer.invoke(channel.proposals, { status }),
  resolveProposal: (id: string, decision: "approve" | "reject", note?: string) =>
    ipcRenderer.invoke(channel.resolveProposal, { id, decision, note }),
  operations: () => ipcRenderer.invoke(channel.operations),
  knowledge: () => ipcRenderer.invoke(channel.knowledge),
  diagnostics: () => ipcRenderer.invoke(channel.diagnostics),
});
