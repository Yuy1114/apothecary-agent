const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const channel = {
  dashboard: "apothecary:dashboard",
  chat: "apothecary:chat",
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
} as const;

contextBridge.exposeInMainWorld("apothecary", {
  dashboard: () => ipcRenderer.invoke(channel.dashboard),
  chat: (messages: Array<{ role: "user" | "assistant"; content: string }>) =>
    ipcRenderer.invoke(channel.chat, { messages }),
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
});
