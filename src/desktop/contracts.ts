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

// Quick-ask (划词快问): a one-shot side-channel question about selected text.
// Deliberately carries its own bounded context instead of a threadId — the run
// must stay isolated from conversation memory.
export const QuickAskInputSchema = z.object({
  runId: z.string().uuid(),
  question: z.string().min(1).max(2_000),
  selection: z.string().min(1).max(8_000),
  contextText: z.string().min(1).max(8_000),
  source: z.enum(["chat", "note"]),
  sourcePath: z.string().max(500).optional(),
  priorTurns: z
    .array(z.object({ question: z.string().max(2_000), answer: z.string().max(8_000) }))
    .max(2)
    .default([]),
});
export type QuickAskInput = z.infer<typeof QuickAskInputSchema>;

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

export const PolishNoteInputSchema = z.object({
  filePath: z.string().min(1),
  modes: z.array(z.enum(["expand", "format", "tags"])).min(1),
});

export const RecentActivityInputSchema = z.object({
  days: z.number().int().min(1).max(90).optional(),
});

// 日记 (journal): unified daily/weekly/monthly/yearly notes with a 计划 section.
export const CadenceSchema = z.enum(["daily", "weekly", "monthly", "yearly"]);
export type CadenceInput = z.infer<typeof CadenceSchema>;

export const JournalReadInputSchema = z.object({
  cadence: CadenceSchema,
  key: z.string().min(4).max(10).optional(), // omitted = current period
});

export const JournalInstantiateInputSchema = z.object({
  cadence: CadenceSchema,
  key: z.string().min(4).max(10),
});

export const JournalToggleInputSchema = z.object({
  cadence: CadenceSchema,
  key: z.string().min(4).max(10),
  line: z.number().int().positive(),
  raw: z.string().max(1_000).optional(),
});

export const JournalAddPlanInputSchema = z.object({
  // A period target lands in that note (instantiating it first); a template
  // target edits journal/_templates/<cadence>.md — the recurrence mechanism.
  target: z.union([
    z.object({ kind: z.literal("period"), cadence: CadenceSchema, key: z.string().min(4).max(10) }),
    z.object({ kind: z.literal("template"), cadence: CadenceSchema }),
  ]),
  item: z.object({
    title: z.string().min(1).max(200),
    time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  }),
});

// Opening a note in the OS default editor is a main-process action (shell).
export const JournalOpenEditorInputSchema = z.object({ relPath: z.string().min(1).max(500) });

// Main-process push: deep-link the renderer to a view (notification/tray click).
export const NavigationTargetSchema = z.object({
  view: z.literal("journal"),
  cadence: CadenceSchema,
  key: z.string().min(4).max(10),
});
export type NavigationTarget = z.infer<typeof NavigationTargetSchema>;

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
  autoIntakePlanning: z.boolean().optional(),
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
  quickAsk: "apothecary:quick-ask",
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
  threads: "apothecary:threads",
  threadMessages: "apothecary:thread-messages",
  createThread: "apothecary:create-thread",
  deleteThread: "apothecary:delete-thread",
  journalRead: "apothecary:journal-read",
  journalInstantiate: "apothecary:journal-instantiate",
  journalToggle: "apothecary:journal-toggle",
  journalAddPlan: "apothecary:journal-add-plan",
  journalOpenEditor: "apothecary:journal-open-editor",
  navigate: "apothecary:navigate",
  pendingNavigation: "apothecary:pending-navigation",
} as const;
