# Apothecary Agent v1 Closure Plan

> **状态：完成。** 本计划中的 v1 closure 工作已实现并通过验收；最终证据见 [`v1-completion-report.md`](./v1-completion-report.md)。

> 创建日期：2026-07-03  
> 当前基线：`ee12066`  
> 依据：[`v1-product-boundary-and-roadmap.md`](./v1-product-boundary-and-roadmap.md) 与 [`v1-project-review-2026-07-03.md`](./v1-project-review-2026-07-03.md)

## 目标

当前项目已进入 v1 release candidate 前期。核心能力基本齐备，接下来的工作不再以增加功能入口为主，而是消除治理例外、补全一致性机制，并用端到端测试证明产品闭环。

本轮 closure 的完成目标是：

> 用户批准一次修改后，系统能够安全执行，并使 physical layer、README/index、vector index、semantic layer、relations、canonical candidates、knowledge profile 和 operation ledger 达到可验证的一致状态。

## 完成范围

本轮需要完成四组工作：

1. 收敛所有 human-readable layer 写入口到 unified proposal；
2. 为 post-apply refresh 建立持久化、可补偿的一致性机制；
3. 将 knowledge profile 纳入变更后的刷新闭环；
4. 补齐关键产品路径的端到端验收。

Inbox `.txt` 支持作为 v1 最后一项产品边界补全工作，在核心一致性闭环之后推进。

## P0-1：收敛 Human Layer 写入口

### 问题

README 和产品边界要求所有 human-readable layer 修改都经过 unified proposal。但当前 `vaultIngestor` 仍暴露 `ingestVault`，可以直接写入笔记、README、vector index 和 ledger，不产生 proposal record。

这会形成两个治理路径：

```text
标准路径：proposeChange → review → resolveProposal → apply → audit

例外路径：ingestVault → direct write → audit
```

即使 direct write 受到 Mastra approval gate 保护，也无法满足统一 proposal 的持久化审阅、拒绝记录和生命周期要求。

### 实现内容

- 从 `vaultIngestor` 的 tools 中移除 `ingestVault`；
- 修改 ingestor instructions：新知识必须生成 `capture` proposal；
- 保留 `writeVaultNote` 作为 proposal executor 的内部 primitive，不作为 agent 可直接调用的写入口；
- 检查所有 agent 注册的 tools，确认不存在其他绕过 proposal 的 human-layer mutation；
- 为“agent 工具集合不存在 direct human write”增加结构性测试；
- 更新 README，不再把 direct ingest 描述为合法路径。

### 重点文件

- `src/mastra/agents/vault-ingestor.ts`
- `src/mastra/tools/ingest-vault.ts`
- `src/mastra/tools/ingest-core.ts`
- `src/mastra/agents/vault-curator.ts`
- `src/mastra/agents/vault-reviewer.ts`
- `README.md`

### 验收标准

- agent 不能直接调用工具写入 human-readable layer；
- capture 必须先生成 `.agent/proposals/*.json`；
- proposal 可被列出、拒绝或批准；
- rejection 不修改用户文件；
- approval 后才写文件并记录 operation ledger；
- `writeVaultNote` 只被 proposal executor 或明确的内部测试调用。

### 建议提交

```text
refactor: route vault ingestion through unified proposals
```

## P0-2：Post-Apply Refresh 持久化补偿

### 问题

当前 proposal executor 会同步尝试 semantic refresh，但 refresh 失败时只输出 warning，随后仍将 proposal 标记为 `applied`。

这会产生一种无法通过持久化状态观察的中间情况：

```text
physical change succeeded
index updated
semantic refresh failed
proposal = applied
no durable repair record
```

依赖 watcher 作为唯一补偿不够可靠，因为失败可能来自模型、网络、artifact 写入或进程退出，且 watcher 不一定再次产生事件。

### 状态语义

建议保留简单的 proposal lifecycle：

```text
proposed → applied | rejected
```

不要为了 semantic refresh 引入复杂的 proposal 状态机。physical mutation 一旦成功，proposal 的用户动作已经完成，可以保持 `applied`；一致性补偿应由独立的 durable sync work item 表达。

推荐模型：

```text
proposal applied
    ↓
post-apply refresh
    ├─ success → consistency work complete
    └─ failure → enqueue durable sync work
                         ↓
                  retry / manual sync
                         ↓
                     resolved
```

### 实现内容

- 定义 post-apply consistency work item schema；
- 至少记录：proposal id、affected paths、失败阶段、错误摘要、创建时间、重试次数、状态；
- 将 work item 持久化到 `.agent/sync/`，或复用 pending change queue；
- proposal apply 前先确定完整 affected path set；
- semantic refresh 失败时持久化补偿任务，而不是只记录 warning；
- manual sync / dedicated retry tool 能重新执行任务；
- 成功后将任务标记 resolved；
- 重试必须幂等，不能重复写用户笔记；
- 在 list pending changes 或独立工具中让用户看见未完成的补偿任务。

### 设计偏好

优先复用现有 pending change queue，避免创建第二套调度系统。可以为 proposal apply 产生的变化增加来源：

```ts
source: "proposal"
proposalId: string
```

如果现有 change schema 无法表达失败阶段，再增加轻量 consistency queue。

### 重点文件

- `src/mastra/tools/resolve-proposal-core.ts`
- `src/application/semantic/syncSemanticsFromChanges.ts`
- `src/vault/changeLog.ts`
- `src/mastra/tools/manual-sync-core.ts`
- `src/mastra/tools/list-pending-changes.ts`
- `src/mastra/tools/resolve-pending-changes.ts`

### 验收标准

- semantic refresh 成功时不产生遗留补偿任务；
- refresh 失败时 proposal 可以保持 applied，但必须存在 durable pending work；
- 进程重启后 pending work 仍存在；
- retry 成功后 semantic artifacts 与文件一致；
- retry 不再次执行 physical mutation；
- 用户可以查看失败原因、affected paths 和 retry 状态；
- README 准确描述 eventual consistency，而不是宣称不存在的强一致。

### 建议提交

```text
feat: persist post-apply semantic refresh recovery work
```

## P0-3：Knowledge Profile 进入一致性闭环

### 问题

当前 post-apply pipeline 可以刷新 file summaries、semantic graph、relations 和 canonical candidates，但 knowledge profile 仍依赖独立 workflow。

因此新 capture、canonical note、merge 或 archive 完成后，profile 可能继续表达旧的主题、项目、重复区和薄弱区。

### 实现内容

- 明确 profile refresh 的触发策略；
- proposal apply 后 semantic refresh 成功时刷新 profile；
- manual sync 完成 semantic refresh 后刷新 profile；
- 避免每个小文件事件都立即调用模型造成高成本；
- 支持 debounce、dirty flag 或批量刷新；
- profile refresh 失败也必须进入 durable recovery work；
- profile artifact 写入应保持原子性。

### 推荐策略

将一致性工作拆成两个阶段：

```text
Stage A：必须及时完成
- file summaries
- semantic graph
- relations
- canonical candidates

Stage B：允许 debounce，但必须可追踪
- knowledge profile
```

可以维护：

```text
.agent/profile/refresh-state.json
```

记录：

- dirty；
- lastSuccessfulRefreshAt；
- changedPaths；
- lastError；
- retryCount。

### 重点文件

- `src/application/profile/generateKnowledgeProfile.ts`
- `src/mastra/workflows/refresh-profile.ts`
- `src/application/semantic/syncSemanticsFromChanges.ts`
- `src/mastra/tools/resolve-proposal-core.ts`
- `src/vault/semanticStore.ts`

### 验收标准

- proposal apply 后 profile 被标记 dirty；
- profile refresh 成功后 dirty 被清除；
- refresh 失败不会静默丢失；
- 多次连续变更可以合并为一次 profile refresh；
- capture/canonical/archive 后 profile 能反映新的知识状态；
- profile 的 `generatedAt` 和 refresh state 可用于判断是否过期。

### 建议提交

```text
feat: track and refresh knowledge profile after semantic changes
```

## P1-1：关键路径端到端验收

### 目标

单元测试证明各个零件正确；端到端测试需要证明产品承诺成立。

现有 capture acceptance test 是良好起点。本轮至少补四条路径。

### 场景 A：Inbox Move

准备：

- inbox 中存在 Markdown 文件；
- source/target 目录具有 README 或允许自动创建；
- move proposal 已生成。

验证：

- approve 前文件未移动；
- approve 后 source 消失、target 存在；
- source README 移除旧链接；
- target README 增加新链接；
- vector index remove/reindex 被调用；
- source summary 被移除；
- target summary 被生成；
- relations/candidates 被刷新；
- operation ledger 有 move 记录；
- proposal 为 applied。

### 场景 B：Manual CRUD Sync

准备：

- 建立初始 snapshot；
- 模拟 watcher 停止；
- 手动 created、modified、deleted 三个文件。

验证：

- manual sync 正确识别三类变化；
- pending queue 内容准确；
- vector index 增删准确；
- semantic summaries 增删准确；
- snapshot 更新；
- 第二次 sync 幂等且无变化。

### 场景 C：Canonical Note

准备：

- 多个 note 共享一个 concept；
- canonical candidate 已生成；
- canonical-note proposal 引用 superseded notes。

验证：

- canonical note 被创建；
- source notes 写入 `superseded_by`；
- 所有相关 note 被 reindex；
- summaries 和 canonical candidates 被刷新；
- RAG 将 superseded notes 排在 current note 后；
- maintenance findings 能发现尚未归档的 superseded notes；
- ledger 记录 canonical operation。

### 场景 D：Refresh Failure Recovery

准备：

- physical mutation 成功；
- stub semantic refresh 第一次失败、第二次成功。

验证：

- proposal 不重复执行 physical mutation；
- 第一次失败产生 durable recovery work；
- 重启式重新加载后任务仍存在；
- retry 成功更新 semantic artifacts；
- recovery work 被标记完成；
- ledger 中没有重复 mutation operation。

### 可选场景 E：View Promotion

验证 view 只能从 `.agent/views/` 经批准进入 human-readable layer，并在 apply 后完成 index、semantic、profile 和 audit 更新。

### 重点目录

- `src/acceptance/`

### 验收标准

- acceptance tests 不访问真实模型或网络；
- 只 stub embeddings、LLM summarizer/profile writer 等外部边界；
- proposal store、filesystem executor、README、ledger、semantic store 使用真实实现；
- 测试可独立运行并清理临时 vault；
- `pnpm run ci` 稳定通过。

### 建议提交

建议每个场景独立提交：

```text
test: add inbox move end-to-end acceptance
test: add manual sync end-to-end acceptance
test: add canonical note end-to-end acceptance
test: add post-apply recovery acceptance
```

## P1-2：Inbox `.txt` 最小闭环

### 问题

Scanner 已能识别 `.txt`，但 curator 读取、semantic summary、manual sync 和 index 流程仍主要围绕 Markdown。

### v1 最小范围

- 读取 UTF-8 `.txt`；
- 提取纯文本内容用于分类；
- 结合 structure 和 semantic layer 生成 move/rename proposal；
- 用户确认后移动 `.txt`；
- ledger 记录 move；
- 不要求将 `.txt` 直接进入 Markdown 专用 vector/semantic pipeline；
- 如果选择转换为 Markdown，必须作为单独 proposal，不能隐式修改格式。

### 实现内容

- 增加通用 text read tool，或扩展现有 read 工具；
- curator inbox instructions 明确支持 `.md`、`.markdown`、`.txt`；
- triage 使用 semantic topics/profile 作为高层上下文；
- `.txt` move 不错误调用 Markdown parser；
- 增加 `.txt` inbox acceptance test。

### 重点文件

- `src/vault/scanner.ts`
- `src/mastra/tools/read-markdown.ts`
- `src/mastra/agents/vault-curator.ts`
- `src/mastra/tools/move-vault-file-core.ts`
- `src/acceptance/`

### 验收标准

- inbox 中的 UTF-8 `.txt` 可以被读取和分类；
- 生成的是 proposal，不会自动移动；
- approve 后正确移动且留下 audit；
- 不执行 PDF/OCR/多模态理解；
- 不隐式把 `.txt` 改写为 Markdown。

### 建议提交

```text
feat: close txt inbox triage path
```

## P1-3：关系语义与文档校准

### 问题

canonical-note executor 已通过 `superseded_by` frontmatter 建立真实方向，但 `relations.json` 中的 `supersedes` edge 仍由 duplicate classification 推导并按路径排序，不能可靠表达方向。

README 也存在“semantic refresh 失败不会影响 applied”与“refresh 完成后才 applied”之间的描述偏差。

完成结果：无向演化关系已改名为 `evolves_with`；真实方向只由 `superseded_by` 表达。README 已改为正常路径同步、失败路径最终一致。

### 实现内容

- 明确 `relations.json` 中 `supersedes` 是否必须有方向；
- 若保留该类型，应从 `superseded_by` frontmatter 构建真实 `old → current` edge；
- duplicate classifier 只提供 evolutionary candidate，不直接伪造方向；
- 或将无方向的分类关系重命名为 `evolves_with`；
- 更新 README 对 strong/eventual consistency 的准确描述；
- 更新 stage acceptance 和 project review 文档中的当前状态。

### 验收标准

- `supersedes.from` 和 `supersedes.to` 的语义明确、可测试；
- relation direction 不依赖文件名字典序；
- README 与实际失败处理逻辑一致；
- 文档不再保留已经关闭的旧待办。

### 建议提交

```text
fix: derive directed supersedes relations from canonical links
docs: align v1 progress with implemented consistency model
```

## 建议执行顺序

```text
1. 收敛 direct write 入口
        ↓
2. 持久化 post-apply recovery
        ↓
3. profile dirty/refresh 机制
        ↓
4. refresh failure E2E
        ↓
5. inbox move + manual sync E2E
        ↓
6. canonical note E2E
        ↓
7. .txt inbox 最小闭环
        ↓
8. directed relations 与文档校准
```

顺序的核心考虑是：先确定唯一写入口和失败语义，再扩大测试覆盖。否则 acceptance test 会固定尚未收敛的行为。

## 建议提交清单

每个提交保持可独立验证：

1. `refactor: route vault ingestion through unified proposals`
2. `feat: persist post-apply semantic refresh recovery work`
3. `feat: track and refresh knowledge profile after semantic changes`
4. `test: add post-apply recovery acceptance`
5. `test: add inbox move end-to-end acceptance`
6. `test: add manual sync end-to-end acceptance`
7. `test: add canonical note end-to-end acceptance`
8. `feat: close txt inbox triage path`
9. `fix: derive directed supersedes relations from canonical links`
10. `docs: mark v1 closure acceptance status`

## 最终验收清单

### Governance

- [x] 所有 agent human-layer mutation 都经过 unified proposal；
- [x] proposal 可审阅、拒绝、批准；
- [x] 所有 payload path 都经过 vault path safety；
- [x] 永久删除无合法执行路径；
- [x] 所有成功 mutation 都有 operation ledger。

### Consistency

- [x] physical mutation 后 index 更新；
- [x] semantic summary 更新或删除；
- [x] graph、relations、canonical candidates 更新；
- [x] profile 刷新或处于可见的 dirty/pending 状态；
- [x] refresh 失败有 durable recovery work；
- [x] retry 幂等且不会重复 mutation。

### Product Paths

- [x] chat capture 完整验收；
- [x] inbox Markdown move 完整验收；
- [x] inbox `.txt` triage 最小闭环；
- [x] manual CRUD sync 完整验收；
- [x] canonical-note 完整验收；
- [x] duplicate merge/archive 完整验收；
- [x] view promotion 完整验收。

### Release Evidence

- [x] `pnpm run ci` 通过；
- [x] acceptance suite 无真实网络依赖；
- [x] README 与实际行为一致；
- [x] stage acceptance 文档更新；
- [x] 使用真实 vault 完成一次只读 smoke test；
- [x] Roadmap Phase 1–5 均有对应代码与验收证据。

## v1 完成判断

当 P0 全部完成、关键 acceptance tests 通过、`.txt` inbox 最小闭环可用，并且所有未完成的一致性工作都能被持久化观察和补偿时，可以将项目状态更新为：

> **Apothecary Agent v1 complete**

届时 v1 的核心产品承诺将不只是“已有实现入口”，而是具备可重复验证的完整闭环：

```text
感知 → 理解 → 建议 → 确认 → 安全执行 → 一致性恢复 → 审计
```
