import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureAgentArtifacts } from "../../artifacts/agentArtifacts.js";
import { generateKnowledgeView } from "../../application/views/generateKnowledgeView.js";
import { renderKnowledgeViewMarkdown } from "../../reports/renderKnowledgeViewMarkdown.js";

function slugify(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[^\w一-鿿]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "view"
  );
}

export const generateKnowledgeViewTool = createTool({
  id: "generateKnowledgeView",
  description:
    "Generate a human-readable knowledge-system view for a topic from the semantic layer: overview, core topics, " +
    "key concepts, current gaps, a recommended reading order, and the source files. Written to .agent/views/ in Chinese. " +
    "Use this when the user asks for an overview/map of what they know about some direction or subject.",
  inputSchema: z.object({
    topic: z.string().describe("The topic or direction to build a knowledge-system view for, e.g. 'Redis' or '后端工程'"),
  }),
  outputSchema: z.object({
    topic: z.string(),
    viewPath: z.string(),
    overview: z.string(),
    sourceFiles: z.array(z.string()),
  }),
  execute: async ({ topic }) => {
    const view = await generateKnowledgeView(topic);
    const artifacts = await ensureAgentArtifacts();
    const viewPath = path.join(artifacts.viewsDir, `${slugify(topic)}.md`);
    await fs.writeFile(viewPath, renderKnowledgeViewMarkdown(view), "utf8");
    return {
      topic: view.topic,
      viewPath: path.relative(artifacts.rootPath, viewPath),
      overview: view.overview,
      sourceFiles: view.sourceFiles,
    };
  },
});
