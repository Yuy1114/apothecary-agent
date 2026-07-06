import { z } from "zod";

/**
 * Human-facing charter config (`~/.apothecary/config.yaml`). These are the
 * user-adjustable parameters that sit alongside AGENT.md (the behaviour charter).
 * Kept intentionally lenient: the user edits this file by hand, so unknown keys
 * pass through and every field has a default rather than throwing on a typo.
 */

export const ScheduleConfigSchema = z
  .object({
    inbox_sweep: z.string().default("daily"),
    weekly_review: z.string().default("sunday"),
    contract_reminder_days: z.number().int().nonnegative().default(30),
    project_stale_days: z.number().int().nonnegative().default(90),
  })
  .passthrough();
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

export const RoutingRuleSchema = z
  .object({
    match: z.string().optional(),
    type: z.string().optional(),
    dest: z.string(),
    rename: z.string().optional(),
    keep_name: z.boolean().optional(),
  })
  .passthrough();
export type RoutingRule = z.infer<typeof RoutingRuleSchema>;

export const ProtectedConfigSchema = z
  .object({
    no_delete: z.boolean().default(true),
    no_export: z.array(z.string()).default(["records/", "media/photos/"]),
    no_edit_body: z.array(z.string()).default(["notes/", "journal/", "areas/", "projects/"]),
  })
  .passthrough();
export type ProtectedConfig = z.infer<typeof ProtectedConfigSchema>;

export const ObsidianConfigSchema = z
  .object({
    exclude: z.array(z.string()).default([]),
    attachments: z.string().default("media/attachments/"),
  })
  .passthrough();
export type ObsidianConfig = z.infer<typeof ObsidianConfigSchema>;

export const CharterConfigSchema = z
  .object({
    schedule: ScheduleConfigSchema.default({}),
    confidence_threshold: z.number().min(0).max(1).default(0.75),
    routing: z.array(RoutingRuleSchema).default([]),
    protected: ProtectedConfigSchema.default({}),
    obsidian: ObsidianConfigSchema.default({}),
  })
  .passthrough();
export type CharterConfig = z.infer<typeof CharterConfigSchema>;

/** Fully-defaulted charter config (used when config.yaml is missing/unreadable). */
export const defaultCharterConfig: CharterConfig = CharterConfigSchema.parse({});
