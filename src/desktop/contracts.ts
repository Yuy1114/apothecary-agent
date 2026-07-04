import { z } from "zod";

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(50_000),
});

export const ChatInputSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1).max(20),
});

export const StartRunInputSchema = ChatInputSchema.extend({
  runId: z.string().uuid(),
});

export const ResolveChangesInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  outcome: z.enum(["processed", "dismissed"]),
});

export const ReadInboxInputSchema = z.object({ filePath: z.string().min(1) });

export const ListProposalsInputSchema = z.object({
  status: z.enum(["proposed", "applied", "rejected"]).optional(),
});

export const ResolveProposalInputSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(2_000).optional(),
});

export const DesktopChannel = {
  dashboard: "apothecary:dashboard",
  chat: "apothecary:chat",
  startRun: "apothecary:start-run",
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
