import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getAgentArtifacts } from "../../artifacts/agentArtifacts.js";
import { KnowledgeProfileSchema } from "../../domain/knowledgeProfile.js";
import { loadProfileRefreshState } from "../../vault/profileState.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";

export const readKnowledgeProfileTool = createTool({
  id: "readKnowledgeProfile",
  description:
    "Read the standing whole-vault knowledge profile (overview, top topics/concepts, active projects, evidence areas, " +
    "weak areas, duplicate counts). Use it for high-level context about the whole vault when answering, classifying, or " +
    "planning maintenance. Returns found=false until the refresh-profile workflow has run.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    found: z.boolean(),
    /** True when the semantic layer changed since the profile was last generated. */
    stale: z.boolean(),
    generatedAt: z.string().optional(),
    overview: z.string().optional(),
    topTopics: z.array(z.object({ label: z.string(), fileCount: z.number() })).optional(),
    topConcepts: z.array(z.object({ label: z.string(), fileCount: z.number() })).optional(),
    activeProjects: z.array(z.string()).optional(),
    evidenceAreas: z.array(z.string()).optional(),
    weakAreas: z.array(z.string()).optional(),
    recommendations: z.array(z.string()).optional(),
  }),
  execute: async () => {
    const profilePath = path.join(getAgentArtifacts().profileDir, "knowledge-profile.json");
    const { dirty } = await loadProfileRefreshState(apothecaryHome());
    try {
      const profile = KnowledgeProfileSchema.parse(JSON.parse(await fs.readFile(profilePath, "utf8")));
      return {
        found: true,
        stale: dirty,
        generatedAt: profile.generatedAt,
        overview: profile.overview,
        topTopics: profile.stats.topTopics,
        topConcepts: profile.stats.topConcepts,
        activeProjects: profile.activeProjects,
        evidenceAreas: profile.evidenceAreas,
        weakAreas: profile.weakAreas,
        recommendations: profile.recommendations,
      };
    } catch {
      return { found: false, stale: dirty };
    }
  },
});
