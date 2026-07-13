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
  threadId: z.string().min(1).optional(),
});

export const ThreadIdInputSchema = z.object({ threadId: z.string().min(1) });

export const CreateThreadInputSchema = z.object({
  threadId: z.string().min(1),
  title: z.string().max(200).optional(),
});

export const ResumeRunInputSchema = z.object({
  runId: z.string().uuid(),
  proposalId: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(2_000).optional(),
});

export const CancelRunInputSchema = z.object({ runId: z.string().uuid() });

export const ResolveApprovalInputSchema = z.object({
  runId: z.string().uuid(),
  toolCallId: z.string().min(1),
  decision: z.enum(["approve", "decline"]),
});

export const ResolveChangesInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  outcome: z.enum(["processed", "dismissed"]),
});

export const ReadInboxInputSchema = z.object({ filePath: z.string().min(1) });

export const VaultFolderInputSchema = z.object({ scopePath: z.string().min(1) });

export const ListProposalsInputSchema = z.object({
  status: z.enum(["proposed", "applied", "rejected"]).optional(),
});

export const ResolveProposalInputSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(2_000).optional(),
});

export const ProposalDiffInputSchema = z.object({ id: z.string().min(1) });

export const RecentActivityInputSchema = z.object({
  days: z.number().int().min(1).max(90).optional(),
});

// Settings/config edits carry secrets and OS-level actions (safeStorage, dialog,
// relaunch), so they are handled in the main process, not through DesktopService.
export const SaveSettingsInputSchema = z.object({
  vaultPath: z.string().min(1).optional(),
  chatModel: z.string().max(200).optional(),
  deepseekBaseUrl: z.string().max(500).optional(),
  embeddingBaseUrl: z.string().max(500).optional(),
  embeddingModel: z.string().max(200).optional(),
  embeddingTimeoutMs: z.number().int().positive().max(600_000).optional(),
  watch: z.boolean().optional(),
  autoIntake: z.boolean().optional(),
  // Plaintext keys from the form: a non-empty value sets/replaces, "" clears, and
  // an absent field leaves the stored (encrypted) key untouched.
  deepseekApiKey: z.string().max(500).optional(),
  embeddingApiKey: z.string().max(500).optional(),
});
export type SaveSettingsInput = z.infer<typeof SaveSettingsInputSchema>;

export const SettingsChannel = {
  get: "apothecary:settings-get",
  save: "apothecary:settings-save",
  chooseVault: "apothecary:settings-choose-vault",
  relaunch: "apothecary:app-relaunch",
} as const;

export const DesktopChannel = {
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
  notes: "apothecary:notes",
  operations: "apothecary:operations",
  recentActivity: "apothecary:recent-activity",
  knowledge: "apothecary:knowledge",
  diagnostics: "apothecary:diagnostics",
  threads: "apothecary:threads",
  threadMessages: "apothecary:thread-messages",
  createThread: "apothecary:create-thread",
  deleteThread: "apothecary:delete-thread",
} as const;
