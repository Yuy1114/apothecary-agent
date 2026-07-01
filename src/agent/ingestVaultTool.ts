import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

const TOPIC_MAP: Array<{ keywords: string[]; dir: string; label: string }> = [
  { keywords: ["java", "spring", "mybatis", "jvm", "并发", "redis", "rabbitmq", "websocket", "微服务"], dir: "notes/programming/Java", label: "Java 后端" },
  { keywords: ["redis"], dir: "notes/programming/Redis", label: "Redis" },
  { keywords: ["react", "前端", "vite", "swr", "jotai"], dir: "notes/programming/React", label: "React" },
  { keywords: ["javascript", "js", "dom", "typescript", "ts"], dir: "notes/programming/JavaScript", label: "JavaScript" },
  { keywords: ["算法", "数据结构", "leetcode", "二叉树", "链表", "动态规划", "bfs", "dfs"], dir: "notes/programming/Data Structures & Algorithms", label: "数据结构与算法" },
  { keywords: ["面试", "简历", "投递", "岗位", "jd"], dir: "career", label: "求职" },
  { keywords: ["项目", "agent", "apothecary", "do-together", "chat-room", "edu-flow"], dir: "projects", label: "项目" },
  { keywords: ["感想", "反思", "复盘", "总结"], dir: "reflections", label: "反思" },
];

function classifyContent(content: string, lower: string): { dir: string; label: string; score: number } {
  let best = { dir: "inbox", label: "未分类", score: 0 };
  for (const topic of TOPIC_MAP) {
    const hits = topic.keywords.filter((kw) => lower.includes(kw)).length;
    if (hits > best.score) best = { dir: topic.dir, label: topic.label, score: hits };
    // Check directory names too
    if (lower.includes(topic.dir.toLowerCase())) {
      best = { dir: topic.dir, label: topic.label, score: Math.max(best.score, 10) };
    }
  }
  return best;
}

function slugify(text: string): string {
  return text
    .replace(/[^\w\u4e00-\u9fff\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

export const ingestVaultTool = createTool({
  id: "ingestVault",
  description:
    "Ingest new content into the vault. This tool classifies the content, creates a properly named markdown file in the right directory, and updates the topic README. Use this whenever the user shares new knowledge, notes, or ideas that should be stored.",
  inputSchema: z.object({
    content: z.string().describe("The full content to ingest. Can be raw text, notes, or formatted markdown."),
    title: z.string().optional().describe("Suggested title for the note. If not provided, one will be generated from the first heading or first line."),
    topic: z.string().optional().describe("Suggested topic area, e.g. 'java', 'react', 'career'. If not provided, the tool will classify automatically."),
  }),
  outputSchema: z.object({
    filePath: z.string(),
    topic: z.string(),
    title: z.string(),
    readmeUpdated: z.boolean(),
  }),
  execute: async ({ content, title: suggestedTitle, topic: suggestedTopic }) => {
    const lower = content.toLowerCase();
    const classification = suggestedTopic
      ? TOPIC_MAP.find((t) => t.keywords.includes(suggestedTopic.toLowerCase()) || t.dir.includes(suggestedTopic.toLowerCase()))
      : null;

    const { dir, label } = classification ?? classifyContent(content, lower);

    // Generate title
    const headingMatch = content.match(/^#\s+(.+)/m);
    const title = suggestedTitle ?? headingMatch?.[1] ?? content.split("\n")[0]?.slice(0, 60) ?? "untitled";

    // Create the file
    const fileName = `${slugify(title)}.md`;
    const dirPath = path.join(VAULT_PATH, dir);
    await fs.mkdir(dirPath, { recursive: true });

    const timestamp = new Date().toISOString().split("T")[0];
    const frontmatter = `---
title: "${title}"
topic: "${label}"
created: ${timestamp}
type: note
---

`;

    const fileContent = content.startsWith("#") ? frontmatter + content : frontmatter + content;
    const filePath = path.join(dirPath, fileName);
    await fs.writeFile(filePath, fileContent, "utf8");

    // Update README
    let readmeUpdated = false;
    const readmePath = path.join(dirPath, "README.md");
    try {
      const existing = await fs.readFile(readmePath, "utf8");
      if (!existing.includes(fileName)) {
        const entry = `- [${title}](${fileName}) — ${new Date().toLocaleDateString("zh-CN")}`;
        await fs.appendFile(readmePath, `${entry}\n`, "utf8");
        readmeUpdated = true;
      }
    } catch {
      // No README yet, create one
      const index = `# ${label}\n\n## 笔记索引\n\n- [${title}](${fileName}) — ${new Date().toLocaleDateString("zh-CN")}\n`;
      await fs.writeFile(readmePath, index, "utf8");
      readmeUpdated = true;
    }

    return {
      filePath: path.relative(VAULT_PATH, filePath),
      topic: label,
      title,
      readmeUpdated,
    };
  },
});
