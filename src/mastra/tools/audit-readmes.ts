import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { proposeReadmeFixes } from "../../application/maintenance/auditReadmes.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export const auditReadmesTool = createTool({
  id: "auditReadmes",
  description:
    "全库结构「大清理」：逐个已归位目录，核对它的 README 笔记索引与实际文件是否一致——" +
    "失效条目（索引列了但文件已不在）、缺失条目（文件存在但索引没列）、标题不符。" +
    "对每个有问题的目录生成一条修正 README 索引的 edit 提案（只重写索引行、保留其余内容），" +
    "文件不直接改，待用户在提案里审批。用于用户要求「做一次大清理 / 结构体检 / 对一下 README」时。" +
    "_inbox、archive、vault 根目录不在核对范围内。",
  inputSchema: z.object({}),
  outputSchema: z.object({
    directoriesWithIssues: z.number(),
    proposalIds: z.array(z.string()),
    findings: z.array(z.object({ dir: z.string(), summary: z.string() })),
  }),
  execute: async () => proposeReadmeFixes(VAULT_PATH),
});
