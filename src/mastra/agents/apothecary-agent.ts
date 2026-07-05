import { Agent } from "@mastra/core/agent";
import { apothecaryMemory } from "../memory.js";
import { agentRuntimeScorers } from "../scorers/answer-relevancy.js";
import { VaultSemanticRecallProcessor } from "../processors/vault-semantic-recall.js";
import { queryVaultTool } from "../tools/rag.js";
import { scanVaultTool } from "../tools/scan-vault.js";
import { readMarkdownTool } from "../tools/read-markdown.js";
import { readVaultTextTool } from "../tools/read-vault-text.js";
import { readFileSummaryTool } from "../tools/read-file-summary.js";
import { listSemanticTopicsTool } from "../tools/list-semantic-topics.js";
import { findRelatedFilesTool } from "../tools/find-related-files.js";
import { generateKnowledgeViewTool } from "../tools/generate-knowledge-view.js";
import { readKnowledgeProfileTool } from "../tools/read-knowledge-profile.js";
import { listPendingChangesTool } from "../tools/list-pending-changes.js";
import { resolvePendingChangesTool } from "../tools/resolve-pending-changes.js";
import { manualSyncTool } from "../tools/manual-sync.js";
import { syncSemanticsTool } from "../tools/sync-semantics.js";
import { retrySemanticRecoveryTool } from "../tools/retry-semantic-recovery.js";
import { proposeChangeTool } from "../tools/propose-change.js";
import { listChangeProposalsTool } from "../tools/list-change-proposals.js";
import { listOperationsTool } from "../tools/list-operations.js";
import { listDuplicateClustersTool } from "../tools/list-duplicate-clusters.js";
import { listRelationsTool } from "../tools/list-relations.js";
import { listCanonicalCandidatesTool } from "../tools/list-canonical-candidates.js";
import { listMaintenanceFindingsTool } from "../tools/list-maintenance-findings.js";
import { organizer } from "./organizer.js";

/**
 * The single user-facing agent for v1.1. The older specialist agents remain
 * useful in Studio for debugging, while this agent owns the product contract:
 * understand the intent, use the right vault capability, and never bypass the
 * proposal boundary for human-readable files.
 */
export const apothecaryAgent = new Agent({
  id: "apothecary-agent",
  name: "Apothecary",
  description: "The unified conversational entrance to the local knowledge apothecary.",
  model: "deepseek/deepseek-v4-flash",
  memory: apothecaryMemory,
  scorers: agentRuntimeScorers,
  inputProcessors: [new VaultSemanticRecallProcessor()],
  // Specialist subagents delegated to natively (Mastra supervisor pattern);
  // the user only ever talks to this agent.
  agents: { organizer },
  instructions: `你是 Apothecary，是 Yuy 本地个人知识药柜的统一入口。

你的职责覆盖问答、知识沉淀、inbox 归位、变化处理、知识画像与维护建议。用户不需要知道内部有哪些专职 agent；你根据意图选择正确工具并把结果解释清楚。

行为规则：
1. 知识问答先使用 RAG/semantic layer，并明确引用来源文件。证据不足时说明不足，不猜测。
2. “保存、添加、整理、移动、合并、归档、修改”用户笔记时，只能创建 unified proposal。绝不能直接修改 human-readable layer。
3. proposal 的批准/拒绝只在桌面端完成；对话中可以创建和解释提案，但不要声称已经批准或执行。桌面端调用 proposeChange 时会暂停本次运行等待用户决定，工具会返回 applied / rejected / failed；拿到结果后如实说明最终状态，failed 时简述原因并给出下一步。
4. 查看 changed files 不会自动清空队列。只有用户明确处理或忽略后，才能 resolve pending change。
5. inbox 归位是 organizer 子 agent 的职责（见下方常见意图）：你负责委派并转达它的结果，不需要、也没有 structure 配置可读；不隐式转换文件格式。
6. 永不永久删除文件。低价值或被吸收内容只能 archive。
7. 默认使用中文，表达简洁、具体，说明下一步和风险。

常见意图：
- “这段内容值得保存” → proposeChange(capture)
- “有哪些文件变了” → listPendingChanges
- “整理 inbox / 归位 / 冷启动” → 委派 organizer 子 agent（它勘查 _inbox、按名字分类、只深挖名字不明确的、产出迁移计划 intake-plan 供你审核；此阶段不移动文件）。你只需转达 organizer 的结果，**绝不要自己 scanVault/readVaultText 逐个整理，也绝不要 proposeChange/capture 计划或把计划写成任何文件**——计划只由 organizer 的 recordDecision 产生
- “最近做了什么” → listOperations / listChangeProposals
- “我的知识体系如何” → readKnowledgeProfile / generateKnowledgeView
- “有哪些内容需要维护” → duplicate/canonical/maintenance tools`,
  tools: {
    queryVault: queryVaultTool,
    scanVault: scanVaultTool,
    readMarkdown: readMarkdownTool,
    readVaultText: readVaultTextTool,
    readFileSummary: readFileSummaryTool,
    listSemanticTopics: listSemanticTopicsTool,
    findRelatedFiles: findRelatedFilesTool,
    generateKnowledgeView: generateKnowledgeViewTool,
    readKnowledgeProfile: readKnowledgeProfileTool,
    listPendingChanges: listPendingChangesTool,
    resolvePendingChanges: resolvePendingChangesTool,
    manualSync: manualSyncTool,
    syncSemantics: syncSemanticsTool,
    retrySemanticRecovery: retrySemanticRecoveryTool,
    proposeChange: proposeChangeTool,
    listChangeProposals: listChangeProposalsTool,
    listOperations: listOperationsTool,
    listDuplicateClusters: listDuplicateClustersTool,
    listRelations: listRelationsTool,
    listCanonicalCandidates: listCanonicalCandidatesTool,
    listMaintenanceFindings: listMaintenanceFindingsTool,
  },
});
