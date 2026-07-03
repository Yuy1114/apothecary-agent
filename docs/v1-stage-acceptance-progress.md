# Apothecary Agent v1 Stage Acceptance Progress

## 目的

这份文档用于阶段性验收 Apothecary Agent v1 的实现进度：明确已经具备的能力、尚未闭环的功能、下一阶段继续推进的内容。

依据文档：[`docs/v1-product-boundary-and-roadmap.md`](./v1-product-boundary-and-roadmap.md)。

当前结论：**v1 主干已经成型，但还不能判定为全部功能完成。**

更准确的状态是：

> 6 个 Capability 都已经有实现入口或主路径，但部分 roadmap 验收项仍停留在骨架、人工约定或局部实现阶段。当前项目处于 v1 alpha / closure pass 前状态。

## 当前验收快照

验证命令已通过：

```bash
pnpm run check
pnpm run build
pnpm vitest run
```

当前测试结果：

- TypeScript check：通过；
- build：通过；
- test：25 个 test files 通过，101 个 tests 通过，1 个 eval test skipped；
- git working tree：干净。

## Capability 验收矩阵

| Capability | Roadmap 目标 | 当前状态 | 验收判断 |
| --- | --- | --- | --- |
| Cap1 Chat with Vault / Knowledge Capture | RAG 问答、引用来源、识别 durable insight、生成保存 proposal、确认后写入并更新索引和 semantic layer | 已有 vault reviewer、RAG、semantic recall、captureInsight approval-gated write | **部分完成**：RAG 主路径完成；capture 不是统一 proposal，写入后 semantic refresh/profile refresh 未完整串联 |
| Cap2 Inbox Triage | 扫描 inbox，理解 Markdown/txt，根据 structure + semantic layer 生成 move/rename/index proposal，确认后移动并更新 README/index、向量索引、file summary、relation | Curator 指令支持 scan inbox + read markdown + propose move；move apply 会 reindex | **部分完成**：txt、README/index 更新、semantic refresh、append-index proposal 还未闭环 |
| Cap3 Change Awareness / Sync | watcher + manual sync，snapshot diff，pending queue，created/modified/deleted，reindex + semantic refresh | watcher、change ledger、pending changes、incremental semantic sync 已有 | **部分完成偏强**：watcher 主路径存在；manual sync/snapshot diff 缺失，created 识别不足 |
| Cap4 Semantic Maintenance | 全库扫描，维护 summaries/topics/concepts/relations，识别重复/过期/散落/分类不一致，生成 edit/merge/archive/canonical-note proposal | file summaries、semantic graph、duplicate detection/classification、merge/archive/edit proposal 已有 | **部分完成**：duplicate 主路径完成；stale/superseded/canonical candidate/canonical-note proposal 不完整 |
| Cap5 Knowledge Profile and System Views | 维护 knowledge-profile.md/json，生成 topic system view，列出 overview/gaps/reading path/source files，支持 view promotion proposal | refresh-profile workflow、knowledge view generator、`.agent/views/` 写入已实现 | **基本完成**：profile/view 主路径完成；view promotion proposal 缺失 |
| Cap6 Governance and Audit | 所有人类阅读层修改走统一 proposal，记录 approval/rejection/apply，维护 operation ledger，永久删除 deny | unified proposal 覆盖 edit/move/archive/merge；operation ledger 已有；危险修改需确认 | **部分完成偏强**：治理主干完成；capture/ingest/structure/view promotion 尚未纳入统一 proposal |

## 已完成的工程主干

### 1. RAG 与聊天问答主路径

已实现内容：

- vault reviewer agent；
- vector index；
- semantic search；
- automatic semantic recall processor；
- 回答时具备引用来源文件的约束。

代表代码：

- `src/mastra/agents/vault-reviewer.ts`
- `src/mastra/tools/rag.ts`
- `src/mastra/processors/vault-semantic-recall.ts`

验收含义：

- 项目已经不是普通文件 CRUD；
- RAG 已经与 semantic layer 发生连接；
- 用户可以围绕 vault 提问，并获得基于 vault 的上下文回答。

### 2. Semantic Layer Foundation

已实现内容：

- file summary schema；
- file summary generation；
- full semantic refresh workflow；
- change-driven incremental semantic sync；
- semantic graph：按 topics / concepts 聚合；
- related files：基于 shared topics/concepts 推导。

代表代码：

- `src/domain/semantic.ts`
- `src/application/semantic/generateFileSummary.ts`
- `src/mastra/workflows/refresh-semantics.ts`
- `src/application/semantic/syncSemanticsFromChanges.ts`
- `src/domain/semanticGraph.ts`
- `src/vault/semanticStore.ts`

验收含义：

- agent 已经能维护自己的理解层；
- 修改文件后可以只刷新受影响文件；
- RAG 可以利用 file summary 扩展上下文。

当前限制：

- semantic relation 仍是简化版：主要通过 topics/concepts 共享关系推导；
- 还没有独立 `relations.json`、`canonical-candidates.json` 等更细 artifact；
- supports / contradicts / supersedes / evidence_for 等关系未形成完整模型。

### 3. Change Awareness 主路径

已实现内容：

- watcher 监听 vault markdown 变化；
- 变化进入 pending change queue；
- change ledger 去重；
- list / resolve pending changes；
- watcher 触发 reindex；
- watcher debounced 触发 semantic sync。

代表代码：

- `src/mastra/workflows/sync-watcher.ts`
- `src/vault/changeLog.ts`
- `src/mastra/tools/list-pending-changes.ts`
- `src/mastra/tools/resolve-pending-changes.ts`
- `src/mastra/tools/sync-semantics.ts`

验收含义：

- 手动改文件不再只是文件系统事件；
- 它可以进入 agent 的 pending work；
- 索引和 semantic layer 可以被刷新。

当前限制：

- watcher 对存在的文件统一记录为 `modified`，没有稳定地区分 `created`；
- manual sync 作为 watcher 补偿尚未实现；
- snapshot diff 尚未实现；
- pending queue 与 review/maintenance 后续动作还需要更明确的产品闭环。

### 4. Governance / Audit 主干

已实现内容：

- unified proposal model；
- proposal store；
- proposal lifecycle：`proposed -> applied | rejected`；
- proposal apply executor；
- operation ledger；
- move/archive/merge/edit 均可被 proposal 驱动；
- 永久删除没有作为合法执行路径。

代表代码：

- `src/domain/proposal.ts`
- `src/vault/proposalStore.ts`
- `src/mastra/tools/propose-change.ts`
- `src/mastra/tools/resolve-proposal-core.ts`
- `src/vault/operationLedger.ts`

验收含义：

- 对用户资产的高风险操作已经有统一治理边界；
- proposal 可以被审阅、批准、拒绝、记录；
- applied operation 能留下审计记录。

当前限制：

- proposal 类型当前只有 `edit` / `move` / `archive` / `merge`；
- roadmap 中的 `capture_proposal`、`structure_proposal`、`canonical_note_proposal`、`view_promotion_proposal` 还未进入统一模型；
- `captureInsight`、`ingestVault`、`updateStructureKeywords` 目前依赖 Mastra approval gate，而不是统一 proposal record。

### 5. Knowledge Profile and System Views

已实现内容：

- 生成 `.agent/profile/knowledge-profile.json`；
- 生成 `.agent/profile/knowledge-profile.md`；
- 基于 semantic graph + RAG 生成 knowledge system view；
- view 默认写入 `.agent/views/`。

代表代码：

- `src/application/profile/generateKnowledgeProfile.ts`
- `src/mastra/workflows/refresh-profile.ts`
- `src/application/views/generateKnowledgeView.ts`
- `src/mastra/tools/generate-knowledge-view.ts`
- `src/reports/renderKnowledgeProfileMarkdown.ts`
- `src/reports/renderKnowledgeViewMarkdown.ts`

验收含义：

- 药柜已经可以生成整体知识画像；
- 用户询问某个方向时，可以生成结构化知识体系视图；
- view 层和 semantic layer 已经分离。

当前限制：

- view promotion proposal 尚未实现；
- view 生成后还不能通过统一 proposal 沉淀为普通 vault note。

### 6. Semantic Maintenance：Duplicate 主路径

已实现内容：

- duplicate candidate detection；
- duplicate classification；
- harmful / contextual / evolutionary / not_duplicate 分类；
- duplicate report artifact；
- curator 可基于 duplicate clusters 发起 merge/edit/archive proposal。

代表代码：

- `src/domain/duplicateDetection.ts`
- `src/application/duplicates/classifyDuplicate.ts`
- `src/mastra/workflows/detect-duplicates.ts`
- `src/mastra/tools/list-duplicate-clusters.ts`

验收含义：

- v1 中最核心的 semantic maintenance 方向已经有实际实现；
- 重复内容不是简单按相似度删除，而是按产品定义区分三类重复。

当前限制：

- stale / superseded detection 不完整；
- scattered insight detection 不完整；
- classification inconsistency detection 不完整；
- canonical note candidate 不完整；
- canonical-note proposal 尚未实现。

## 尚未完成的 v1 Closure 内容

### P0：统一 Proposal 覆盖范围

目标：让 roadmap 中“agent 想改变人类阅读层时必须生成 proposal”成为真实代码边界。

需要推进：

- 扩展 `ProposalTypeSchema`：
  - `capture`
  - `structure`
  - `canonical_note`
  - `view_promotion`
- 为每种 proposal 增加 payload schema；
- 为每种 proposal 增加 apply executor；
- 统一 list / resolve / audit 行为；
- 将 `captureInsight`、`ingestVault`、`updateStructureKeywords` 的 direct approval write 收敛到 proposal flow。

验收标准：

- 所有人类阅读层写入、移动、归档、合并、结构规则更新都能在 `.agent/proposals/` 中看到 proposal record；
- approval / rejection / apply 结果可追踪；
- apply 后有 operation ledger 记录；
- 失败 apply 不吞掉 proposal，仍保持 pending。

### P0：Manual Sync + Snapshot Diff

目标：让 watcher 漏事件时仍能补偿，满足 Cap3 验收。

需要推进：

- 增加 vault snapshot artifact，例如 `.agent/sync/snapshot.json`；
- 记录 path、hash、mtime、mediaType；
- 增加 manual sync workflow/tool；
- 对比旧 snapshot 与当前 scan，生成：
  - created；
  - modified；
  - deleted；
- 将 diff 写入 pending change queue；
- 对 changed/deleted 文件触发 reindex/remove index；
- 串联 incremental semantic sync。

验收标准：

- 关闭 watcher 或模拟漏事件后，manual sync 能补出 pending changes；
- 新增/修改/删除 Markdown 文件能准确显示；
- 变化处理后 vector index 和 semantic layer 更新；
- manual sync 不误改用户笔记。

### P0：Capture and Inbox Triage 闭环

目标：解决 v1 最直接的两个产品入口：新 insight 入库、inbox 归位。

需要推进：

- capture 改为生成 `capture` proposal；
- proposal 中包含建议路径、标题、内容、理由、来源；
- apply capture 后：
  - 写入用户笔记；
  - 更新 README/index；
  - reindex；
  - semantic refresh；
  - operation ledger；
- inbox scan 支持 Markdown 和 txt；
- inbox triage 使用 structure + semantic layer 给出目标位置；
- move apply 后更新目标 README/index；
- move apply 后刷新 semantic layer；
- 支持 append-index proposal 或在 move executor 中内置 README/index 更新策略。

验收标准：

- 对话中的 durable insight 能先生成可审阅 proposal，而不是直接写入；
- inbox 中 `.md` / `.txt` 能生成合理归位建议；
- 用户确认后文件位置、README/index、vector index、semantic layer 均一致。

### P1：Semantic Relations and Canonical Candidates

目标：把当前 topics/concepts 聚合升级为更接近 roadmap 的 semantic layer。

需要推进：

- 明确 relation schema；
- 持久化关系 artifact，例如 `.agent/semantic/relations.json`；
- 支持基础关系：
  - related_to；
  - duplicates；
  - supersedes；
  - evidence_for；
  - applies_to；
- 生成 canonical candidate artifact；
- canonical note proposal 支持创建或更新 canonical note；
- duplicate / maintenance / profile 使用 canonical candidate。

验收标准：

- agent 不只知道文件共享哪些 topic/concept，还知道为什么相关；
- duplicate、evolutionary duplicate、canonical note 能留下可追溯关系；
- RAG 能优先使用 canonical note，同时引用上下文来源。

### P1：Maintenance Proposals 完整化

目标：从 duplicate maintenance 扩展到 v1 roadmap 中的完整维护建议。

需要推进：

- stale / superseded detection；
- scattered insight detection；
- classification inconsistency detection；
- overlong note detection；
- canonical note candidate；
- maintenance finding -> proposal 的稳定映射；
- apply 后自动 semantic refresh / profile refresh。

验收标准：

- maintenance review 不只报告问题，还能生成可执行 proposal；
- proposal 说明原因、影响文件、风险、预期结果；
- 用户确认后执行小规模整理，并留下审计记录。

### P1：View Promotion

目标：让 `.agent/views/` 中的临时知识体系视图可以被用户确认后沉淀为普通 vault note。

需要推进：

- 增加 `view_promotion` proposal；
- payload 包含 source view path、target vault path、suggested content、理由；
- apply 后写入普通 vault note；
- 更新 README/index；
- reindex；
- semantic refresh；
- ledger。

验收标准：

- knowledge view 默认仍写入 `.agent/views/`；
- 只有用户确认 promotion proposal 后，才进入人类阅读层；
- promoted view 可被 RAG 和 profile 使用。

## 推荐后续推进顺序

### Step 1：Governance Closure

先补 proposal 类型和 apply executor，而不是先扩更多智能能力。

原因：v1 的产品边界是“AI 修改用户资产必须可信、可审阅、可追踪”。如果 capture、structure、view promotion 仍绕过 proposal，后续能力越多，治理边界越散。

交付：

- 扩展 proposal domain；
- capture proposal；
- structure proposal；
- view promotion proposal；
- 保持 edit/move/archive/merge 兼容。

### Step 2：Sync Closure

补 manual sync + snapshot diff。

原因：change awareness 是后续 semantic maintenance/profile 的输入基础。没有可靠补偿机制，后续 profile 和 maintenance 可能基于过期理解层。

交付：

- snapshot artifact；
- manual sync tool/workflow；
- created/modified/deleted diff；
- pending queue 写入；
- reindex + semantic sync 串联。

### Step 3：Capture + Inbox Closure

把用户最常用入口打磨到可验收。

原因：这两个入口直接对应 v1 的真实痛点：新知识入库、inbox 归位。

交付：

- capture proposal；
- inbox txt 支持；
- move 后 README/index 更新；
- apply 后 semantic refresh。

### Step 4：Maintenance Depth

在治理和同步闭环稳定后，再推进 canonical / stale / superseded。

原因：这些能力依赖更细 semantic relation，也更容易影响用户资产；应建立在统一 proposal 和 audit 之上。

交付：

- relations artifact；
- canonical candidates；
- stale/superseded detection；
- canonical-note proposal。

## v1 完成判定标准

当以下条件都满足时，可以判定 v1 完成：

1. **Chat/RAG**：回答能基于 vault 检索并引用来源，且可利用 file summary / semantic context。
2. **Capture**：durable insight 先生成 proposal，用户确认后写入、更新 README/index、reindex、semantic refresh、audit。
3. **Inbox**：Markdown/txt 文件能生成归位 proposal，确认后移动并更新 README/index、vector index、semantic layer。
4. **Sync**：watcher 和 manual sync 都能产生 pending changes，created/modified/deleted 处理准确。
5. **Semantic Layer**：file summaries、topics/concepts、relations、duplicates/canonical candidates 至少具备 v1 所需 artifact。
6. **Maintenance**：duplicate、stale/superseded、canonical candidate 能产生小规模可审阅 proposal。
7. **Profile/View**：profile 和 knowledge system view 可生成；view promotion 通过 proposal 进入普通 vault note。
8. **Governance**：所有用户笔记或结构规则变更都经过统一 proposal，永久删除不可执行，operation ledger 可追踪。
9. **Verification**：`pnpm run check && pnpm run build && pnpm vitest run` 通过。

## 当前阶段总结

当前代码已经证明了 Apothecary Agent 的核心方向是成立的：

- 它不是普通 RAG demo；
- 已经有 semantic layer；
- 已经有 Mastra agents/tools/workflows；
- 已经有 watcher、pending queue、operation ledger；
- 已经有 HITL/approval 与 proposal 主干；
- 已经能生成 profile 和 knowledge views；
- duplicate maintenance 已经有实际路径。

但从 v1 roadmap 的严格验收角度看，后续重点不是“再加很多新功能”，而是完成 closure：

> 把已有主路径统一到 proposal governance 下，并补齐 sync、capture、inbox、semantic relation、view promotion 的闭环。
