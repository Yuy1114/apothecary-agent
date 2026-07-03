# Apothecary Agent v1 Completion Report

> 完成日期：2026-07-03
>
> 产品依据：[`v1-product-boundary-and-roadmap.md`](./v1-product-boundary-and-roadmap.md)
>
> Closure 依据：[`v1-closure-plan.md`](./v1-closure-plan.md)

## 最终结论

**Apothecary Agent v1 已完成。**

v1 的六个 Capability 已形成可运行、可审阅、可补偿、可审计的完整主路径：

```text
感知 → 理解 → 建议 → 确认 → 安全执行 → 一致性恢复 → 审计
```

项目已经满足 v1 的核心产品承诺：持续维护本地 Markdown 药柜的高信噪比个人知识画像，同时保证 agent 对人类阅读层的修改必须经过 proposal 和用户确认。

## Capability 验收

| Capability | 最终状态 | 验收证据 |
| --- | --- | --- |
| Cap1 Chat / Knowledge Capture | **完成** | RAG、来源上下文、semantic recall、capture proposal、批准后写入/README/index/semantic/audit；capture E2E |
| Cap2 Inbox Triage | **完成** | inbox scan、Markdown/`.txt` 安全读取、move proposal、批准后移动、README/index/audit；Markdown 与 `.txt` E2E |
| Cap3 Change Awareness / Sync | **完成** | watcher、pending queue、manual sync、snapshot diff、created/modified/deleted、index 与 semantic refresh；manual CRUD E2E |
| Cap4 Semantic Maintenance | **完成** | summaries、topics/concepts、typed relations、duplicate 三分类、canonical candidates、maintenance findings、merge/archive/canonical-note proposal；maintenance E2E |
| Cap5 Profile / System Views | **完成** | profile md/json、profile dirty state、knowledge views、view promotion proposal；view promotion E2E |
| Cap6 Governance / Audit | **完成** | unified proposal、approval/rejection/apply、path safety、durable recovery、operation ledger、永久删除 deny |

## 核心治理不变量

- Agent 不再暴露绕过 proposal 的 human-layer mutation tool；
- v2 范围的 bulk reorganize workflow 不在 v1 runtime 注册；
- 所有 proposal payload path 都必须留在 vault 内；
- view promotion 的 source 必须位于 `.agent/views/`；
- view promotion 的 target 必须位于 human-readable layer；
- canonical note 不能写入 `.agent/`；
- move 不覆盖已有目标；
- archive 是非破坏性退休路径；
- 永久删除没有合法 executor；
- proposal apply 失败时保持 pending；
- physical mutation 成功但 semantic refresh 失败时，产生 durable recovery work，不重复执行 physical mutation；
- 所有成功 mutation 都写入 operation ledger。

## 一致性模型

v1 使用“正常路径同步、失败路径最终一致”的模型：

```text
proposal approved
    ↓
physical mutation + vector index
    ↓
semantic summary + graph + relations + canonical candidates
    ├─ success → profile marked dirty / refreshable
    └─ failure → durable recovery work → idempotent retry
```

Knowledge profile 是全库级、模型驱动的高成本 artifact，因此 semantic change 会将它标记为 dirty；profile workflow 成功后清除 dirty。系统不会把过期 profile 静默伪装成最新状态。

## Semantic Relation 语义

`relations.json` 中的边全部为无向关系：

- `related_to`：共享概念；
- `duplicates`：有害重复；
- `evolves_with`：存在思想演化关系，但不伪造方向。

真正有向的 supersession 由 canonical-note executor 写入旧笔记的 `superseded_by` frontmatter。RAG 会降低 superseded note 的排序，但仍保留上下文可追溯性。

## Acceptance Suite

已覆盖：

- capture proposal；
- Markdown inbox move；
- `.txt` inbox triage/move；
- manual created/modified/deleted sync 与幂等；
- canonical note 与 superseded finding；
- post-apply recovery；
- duplicate merge + archive；
- view promotion；
- path safety、proposal lifecycle、ledger、semantic stores、profile state 等单元/集成测试。

最终 CI：

```text
TypeScript check: passed
Build: passed
Test files: 48 passed, 1 skipped
Tests: 187 passed, 1 skipped
```

跳过项是需要 `DEEPSEEK_API_KEY` 的真实模型 answer-relevancy eval。它属于部署环境验证，不影响无网络、确定性的本地闭环验收；配置 key 后可直接执行。

## 真实 Vault Smoke Test

对 `/Users/yuy/apothecary-vault` 执行了只读扫描：

```text
total files: 173
markdown files: 163
top-level: notes, career, logs, projects, interviews, journal, inbox, reflections
```

扫描成功，未修改真实 vault。涉及真实笔记写入的 smoke test 仍应遵守产品自身的 proposal/approval 约束，在实际使用时由用户批准执行。

## v1 边界确认

v1 没有越界实现以下非目标：

- 永久删除用户文件；
- 无确认的大规模重排；
- 深度 PDF/OCR/多模态理解；
- 完整图谱前端；
- 多用户/云同步；
- 职业规划或学习计划系统。

## 后续方向

v1 完成不代表产品停止演化。后续工作进入 v1.5/v2：

- 更强的 canonicalization 与 source/evidence relations；
- 更丰富的维护 finding；
- 受控的全库 restructure plan；
- 真实模型质量 eval 数据集；
- 性能、成本与失败注入测试。

这些均不是 v1 completion blocker。

## Release Statement

> Apothecary Agent v1 complete：本地个人知识库维护 agent 已具备 semantic layer、RAG、capture、inbox triage、change awareness、knowledge profile、semantic maintenance、HITL proposal、durable recovery 与 audit 的完整产品闭环。
