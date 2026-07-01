import { z } from "zod";

export const KnowledgeTopicCategorySchema = z.enum([
  "project",
  "concept",
  "course",
  "reflection",
  "source",
  "person",
  "tool",
  "unknown",
]);
export type KnowledgeTopicCategory = z.infer<typeof KnowledgeTopicCategorySchema>;

export const TopicFileRoleSchema = z.enum([
  "overview",
  "source",
  "decision",
  "implementation",
  "reflection",
  "reference",
  "draft",
  "outdated",
  "index",
  "unknown",
]);
export type TopicFileRole = z.infer<typeof TopicFileRoleSchema>;

export const TopicFileSchema = z.object({
  path: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  role: TopicFileRoleSchema,
  relevance: z.number().min(0).max(1),
});
export type TopicFile = z.infer<typeof TopicFileSchema>;

export const KnowledgeTopicSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: KnowledgeTopicCategorySchema,
  summary: z.string(),
  keyConcepts: z.array(z.string()),
  relatedFiles: z.array(TopicFileSchema),
  openQuestions: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export type KnowledgeTopic = z.infer<typeof KnowledgeTopicSchema>;

export const KnowledgeMapSchema = z.object({
  id: z.string().min(1),
  vaultPath: z.string().min(1),
  scopePath: z.string().optional(),
  generatedAt: z.string().min(1),
  basedOnScanId: z.string().min(1),
  topics: z.array(KnowledgeTopicSchema),
  summary: z.string(),
});
export type KnowledgeMap = z.infer<typeof KnowledgeMapSchema>;
