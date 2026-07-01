import { z } from "zod";

export const ApothecaryConfigSchema = z.object({
  version: z.literal(1),
  reviewer: z.discriminatedUnion("provider", [
    z.object({ provider: z.literal("deterministic") }),
    z.object({
      provider: z.literal("openai"),
      model: z.string(),
      apiKey: z.string().optional(),
      baseURL: z.string().optional(),
    }),
  ]),
  scan: z.object({
    ignore: z.array(z.string()),
    include_hash: z.boolean(),
    recent_files_limit: z.number().int().positive(),
  }),
  map: z.object({
    max_topics: z.number().int().positive(),
    max_files_per_topic: z.number().int().positive(),
  }),
  review: z.object({
    long_context_word_threshold: z.number().int().positive(),
    long_context_line_threshold: z.number().int().positive(),
  }),
});

export type ApothecaryConfig = z.infer<typeof ApothecaryConfigSchema>;
