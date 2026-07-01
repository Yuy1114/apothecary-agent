import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { reindexFile } from "./rag.js";
import { loadStructure, classifyWithStructure } from "./vault-structure.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

function slugify(text: string): string {
  return text.replace(/[^\w\u4e00-\u9fff\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60);
}

export const ingestVaultTool = createTool({
  id: "ingestVault",
  description:
    "Ingest new content into the vault. Classifies content using the vault structure config (.agent/structure.yaml), creates a file in the right directory, updates README, and auto-indexes for search.",
  inputSchema: z.object({
    content: z.string().describe("The full content to ingest."),
    title: z.string().optional().describe("Suggested title."),
    topic: z.string().optional().describe("Hint: directory path like 'notes/programming/Redis' or description match."),
  }),
  outputSchema: z.object({
    filePath: z.string(),
    topic: z.string(),
    title: z.string(),
    readmeUpdated: z.boolean(),
  }),
  execute: async ({ content, title: suggestedTitle, topic: suggestedTopic }) => {
    const structure = await loadStructure();

    let dir = "inbox";
    let label = "未分类";

    if (suggestedTopic) {
      if (structure.directories[suggestedTopic]) {
        dir = suggestedTopic;
        label = structure.directories[suggestedTopic].description;
      } else {
        for (const [d, def] of Object.entries(structure.directories)) {
          if (!def.keywords) continue;
          if (def.keywords.some((kw) => suggestedTopic.toLowerCase().includes(kw))) {
            dir = d;
            label = def.description;
            break;
          }
        }
      }
    }

    if (dir === "inbox") {
      ({ dir, label } = classifyWithStructure(content, structure));
    }

    const headingMatch = content.match(/^#\s+(.+)/m);
    const title = suggestedTitle ?? headingMatch?.[1] ?? content.split("\n")[0]?.slice(0, 60) ?? "untitled";
    const fileName = `${slugify(title)}.md`;
    const dirPath = path.join(VAULT_PATH, dir);
    await fs.mkdir(dirPath, { recursive: true });

    const timestamp = new Date().toISOString().split("T")[0];
    const fileContent = `---\ntitle: "${title}"\ntopic: "${label}"\ncreated: ${timestamp}\ntype: note\n---\n\n${content}`;
    const filePath = path.join(dirPath, fileName);
    await fs.writeFile(filePath, fileContent, "utf8");

    let readmeUpdated = false;
    const readmePath = path.join(dirPath, "README.md");
    try {
      const existing = await fs.readFile(readmePath, "utf8");
      if (!existing.includes(fileName)) {
        await fs.appendFile(readmePath, `- [${title}](${fileName}) — ${new Date().toLocaleDateString("zh-CN")}\n`, "utf8");
        readmeUpdated = true;
      }
    } catch {
      await fs.writeFile(readmePath, `# ${label}\n\n## 笔记索引\n\n- [${title}](${fileName}) — ${new Date().toLocaleDateString("zh-CN")}\n`, "utf8");
      readmeUpdated = true;
    }

    const relativePath = path.relative(VAULT_PATH, filePath);
    await reindexFile(relativePath);

    return { filePath: relativePath, topic: label, title, readmeUpdated };
  },
});
