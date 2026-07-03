# Apothecary Agent v1 项目进展 Review

> **历史说明：** 本文记录 `624f5c7` 时的阶段 review。文中的 75–80% 与未完成项已被后续 closure 工作取代；当前最终状态见 [`v1-completion-report.md`](./v1-completion-report.md)。

> Review 日期：2026-07-03  
> Review 基线：`624f5c7`（`main` / `origin/main`）  
> 产品依据：[`v1-product-boundary-and-roadmap.md`](./v1-product-boundary-and-roadmap.md)

## 结论

Apothecary Agent 的 v1 主干已经形成，当前整体功能完成度约为 **75–80%**。

六个 Capability 都有实际实现。其中 Change Awareness、Knowledge Profile 已基本闭环；Chat/Capture 和 Governance 的主路径较完整；Inbox Triage 与 Semantic Maintenance 仍有明显缺口。

当前更准确的阶段判断是：

> **v1 beta / closure pass 中后段，暂不建议宣布 v1 全部完成。**

项目已经具备 semantic layer、RAG、change awareness、proposal、HITL、operation ledger、knowledge profile 和 maintenance workflow，不再是普通 RAG demo。发布 v1 前的重点应从“继续增加入口”转向“确保每次真实改动都安全、可审计，并与语义层保持一致”。

## 验证结果

Review 期间执行：

```bash
pnpm run ci
```

结果：

- TypeScript check：通过；
- build：通过；
- test files：31 passed，1 skipped；
- tests：137 passed，1 skipped；
- git working tree：干净。

跳过的是依赖真实模型 API key 的 `vaultReviewer` eval。该 eval 目前只验证基础回答相关性，尚不能替代完整的 RAG、capture、inbox 和 proposal apply 端到端验收。

## Capability 验收矩阵

| Capability | 当前判断 | 已具备 | 主要缺口 |
| --- | --- | --- | --- |
| Cap1 Chat with Vault / Knowledge Capture | **部分完成偏强** | RAG、来源引用约束、semantic recall、capture proposal、确认后写入、README 更新、reindex、ledger | capture apply 后未自动刷新 semantic layer、relations 和 profile |
| Cap2 Inbox Triage | **部分完成** | inbox 扫描、Markdown move proposal、确认后移动、README 更新、reindex | `.txt` 只有扫描层识别；分类主要依赖 structure，尚未稳定结合 semantic layer；move 后 semantic/profile 未自动刷新 |
| Cap3 Change Awareness / Sync | **基本完成** | watcher、pending queue、manual sync、snapshot diff、created/modified/deleted、reindex、incremental semantic refresh | watcher 自身仍不能稳定区分 created；pending change 到 review/maintenance 的产品闭环仍可加强 |
| Cap4 Semantic Maintenance | **部分完成** | semantic summaries、topics/concepts、typed relations、duplicate detection、三类 duplicate classification、edit/merge/archive proposal | canonical candidate、canonical-note proposal、scattered insight、完整 classification inconsistency 和 superseded workflow 未完成 |
| Cap5 Knowledge Profile and System Views | **基本完成** | profile markdown/json、knowledge system view、`.agent/views/`、view promotion proposal | promotion apply 后未自动刷新 semantic/profile；缺少更强的真实 vault 质量验收 |
| Cap6 Governance and Audit | **部分完成偏强** | 统一 proposal lifecycle、approval/rejection/apply、operation ledger、永久删除无合法执行路径 | 缺少 `canonical_note` proposal；executor 路径安全边界不足；治理约束尚未在所有底层写入口结构性强制 |

## 相比旧进度文档的新进展

现有 [`v1-stage-acceptance-progress.md`](./v1-stage-acceptance-progress.md) 创建后，项目又完成了四组 closure 工作，因此其中部分“待办”已经过期：

1. `c9e4b16`：统一 proposal 扩展到 `capture`、`structure`、`view_promotion`；
2. `0a7ea56`：加入 manual sync 与 snapshot diff；
3. `709337f`：move 后更新目录 README index；
4. `624f5c7`：加入持久化 typed semantic relation layer。

因此，Cap3、Cap5、Cap6 的当前进度比旧文档记录更靠前，但这些新增能力还没有完全解决 apply 后一致性、安全边界和 canonicalization 问题。

## 主要发现

### P0：Proposal apply 后没有形成统一闭环

Roadmap 的核心闭环要求真实文件变化后同步更新：

```text
physical layer
  → vector index
  → file summaries
  → semantic relations
  → knowledge profile
```

当前 manual sync 已经能够在发现变化后串联 incremental semantic refresh；但 edit、capture、move、merge、archive、view promotion 等 proposal executor 通常只完成文件操作、向量 reindex 和 operation ledger。

这意味着 proposal 显示为 `applied` 时，physical layer 与 semantic/profile layer 仍可能暂时不一致，需要后续 watcher 或 manual sync 才能修复。

建议抽取统一的 post-apply pipeline，例如：

```ts
postApplyRefresh({ created, modified, deleted })
```

所有改变 human-readable layer 的 executor 成功后必须经过同一条管线，再将 proposal 标记为 `applied`。

### P0：Proposal executor 缺少统一路径安全校验

统一 proposal executor 中仍存在直接使用 `path.join(VAULT_PATH, payloadPath)` 写入或访问文件的路径。若 proposal payload 含有 `../` 或绝对路径，理论上可能逃逸 vault 根目录。

项目已有 `src/safety/pathSafety.ts`，但它尚未成为 unified proposal executor 的强制边界。

对于强调“AI 修改用户资产必须可信”的产品，这是 v1 发布前必须解决的问题：

- 所有 payload path 必须是 vault-relative path；
- resolve 后必须仍位于允许的 vault 根目录内；
- `.agent/` 与 human-readable layer 的可写范围应按 proposal type 明确限制；
- move、archive、merge、edit、capture、view promotion 应复用同一套路径校验。

### P1：Canonicalization 尚未形成完整产品能力

当前 proposal 支持：

- edit；
- move；
- archive；
- merge；
- capture；
- structure；
- view promotion。

Roadmap 中的 `canonical_note_proposal` 仍未实现。

当前 relation layer 已支持：

- `related_to`；
- `duplicates`；
- `supersedes`。

但仍缺：

- canonical candidates artifact；
- `evidence_for`、`applies_to` 等关系；
- canonical note 创建/更新 executor；
- RAG 对 canonical note 的优先检索策略；
- 当前观点与历史上下文之间的可追溯链路。

此外，现有 `supersedes` relation 对文件对进行排序保存，并不能可靠表达“哪一个观点取代哪一个观点”。在 canonicalization 前需要明确有方向关系的语义和生成依据。

### P1：Inbox `.txt` 尚未达到 roadmap 的理解与归位要求

Scanner 已能把 `.txt` 识别为 text media type，但主要 semantic summary、manual sync、RAG indexing 和 triage 流程仍以 Markdown 为中心。

因此当前状态更准确地说是：

> 支持发现 `.txt`，尚未完整支持理解、生成归位 proposal、apply 后进入 semantic layer。

### P1：真实模型与真实 vault 验收不足

单元测试对纯函数、schema、snapshot diff、proposal lifecycle 和部分 executor 的覆盖较好，但还缺一条完整验收链：

1. 对话产生 durable insight；
2. 生成 proposal；
3. 用户 approve；
4. 写入 physical layer；
5. README/index 更新；
6. vector index 更新；
7. semantic summary/relations/profile 更新；
8. RAG 能引用新内容；
9. operation ledger 能追踪全过程。

Inbox move、手动 CRUD sync、duplicate merge 和 view promotion 也应各有一条同等级的端到端验收。

## 工程标准轴

仓库中没有发现独立的 coding standards、contributing 或 agent review standards 文档，因此本次不能对“是否符合项目书面编码规范”作完整判断。

可以确认的是：

- 类型检查、构建和测试全部通过；
- domain/application/vault/mastra 分层已经形成；
- schema 和核心纯函数有较好的单元测试；
- 部分写入路径存在新旧两套 proposal/apply 模型并存，需要后续收敛；
- README 目前过于简短，还不足以指导完整的本地配置、workflow 验收和故障排查。

## 推荐收尾顺序

### Closure 1：安全与一致性

1. 给全部 proposal executor 增加统一 vault path safety；
2. 建立统一 post-apply refresh pipeline；
3. 确保 pipeline 完成前 proposal 不进入 `applied`；
4. 补失败恢复与幂等测试。

### Closure 2：产品入口验收

1. 完成 capture 端到端验收；
2. 完成 Markdown / `.txt` inbox triage；
3. 验证 move 后 README、index、semantic、profile 一致；
4. 完成 watcher 漏事件后的 manual sync 验收。

### Closure 3：Semantic Maintenance

1. canonical candidate artifact；
2. directed `supersedes`；
3. `canonical_note` proposal；
4. stale、scattered、classification inconsistency 的 finding-to-proposal 映射；
5. canonical-aware RAG。

### Closure 4：发布证据

1. 使用真实 vault fixture 建立可重复的 acceptance suite；
2. 增加真实模型 eval 或录制式集成测试；
3. 更新 README 和 stage acceptance 文档；
4. 按 roadmap 的 Phase 1–5 逐项签署验收结果。

## v1 完成定义建议

满足以下条件后，可以把状态从 v1 beta 更新为 v1 complete：

- 所有 human-readable layer 写操作都受到统一 proposal 和 path safety 约束；
- proposal apply 后 physical、index、semantic、relations、profile 自动一致；
- capture、inbox、manual CRUD、maintenance、view promotion 各有端到端验收；
- Markdown 与 `.txt` inbox 文件均可完成归位闭环；
- canonical-note 最小闭环可用；
- operation ledger 能追踪所有已批准的用户资产变化；
- roadmap Phase 1–5 的验收项均有代码、测试或真实运行证据。

## 最终判断

Apothecary Agent 已经证明了产品的核心工程叙事：它围绕真实个人知识库建立了输入、理解、确认、执行、同步和审计闭环，并以 semantic layer 作为长期理解资产。

当前最关键的缺口不是“是否有这些功能入口”，而是：

> **用户确认一次修改后，系统能否安全地完成动作，并保证 physical layer、semantic layer 和 knowledge profile 全部一致。**

解决这条闭环，再补上最小 canonicalization 和真实 vault 端到端验收，v1 就具备明确的完成条件。
