# Studio v1 验收清单

阶段一封版标准：**下面 7 项能力全部能在 Mastra Studio 里跑通，v1 阶段一即正式完成。**（产品只给自己用，Studio 即前端，不自建 UI。）

用法：`mastra dev` 起 Studio → 主要在 **Apothecary agent** 对话页走查（唯一注册的 user-facing agent），少数直接跑 workflow。每项走一遍，勾上 ✅ / ❌，❌ 记原因。

> 结论前置（2026-07-06 实测更新）：**Studio 的原生审批（approve/decline）机制已证实可用**——HTTP 层 suspend→suspended-runs→approve-tool-call 全通，Studio 前端 bundle 含 approve/decline UI。真正剩下的是一个**接线缺口**：批准/落地 proposal 的 `resolveProposalTool` 没挂到 agent、也没注册成 workflow，所以 Studio 里能建提案却无法 approve/apply（详见 Cap 7）。修一处即可闭合。

---

## Cap 1 — 文件监听 + 启动同步

| 项 | 内容 |
|---|---|
| 入口 | 服务启动时 `startVaultWatcher`（`src/mastra/index.ts:128`）自动运行；手动补偿走 `manual-sync` workflow 或对话里 `manualSync` tool |
| 输入 | 起 Studio 后，在药柜里手动改一个 .md、新增一个文件、删一个文件 |
| 期望 | watcher 捕获变化 → 进 change ledger；对话问「有哪些文件变了」→ `listPendingChanges` 列出 created/modified/deleted。跑 `manual-sync` 能补偿 watcher 漏掉的事件（snapshot diff 能区分增改删） |
| Studio 可完成 | 应该可以（watcher 随进程跑，workflow 可直接触发） |
| 结果 | ☐ |

## Cap 2 — RAG 问答 + 来源标注

| 项 | 内容 |
|---|---|
| 入口 | Apothecary 对话；底层 `queryVault` tool + `VaultSemanticRecallProcessor` 自动注入 |
| 输入 | 问一个药柜里确实有内容的问题；再问一个确实没有的问题 |
| 期望 | 有内容：回答结尾另起一行「来源：」列出真实文件路径；被 supersede 的笔记会被降权并标注。无内容：明确说「未在药柜中找到相关内容」，不杜撰路径 |
| Studio 可完成 | 可以 |
| 结果 | ☐ |

## Cap 3 — inbox 整理（分类/重命名/去重）

| 项 | 内容 |
|---|---|
| 入口 | 对话「整理 inbox / 归位」→ 委派 organizer 子 agent 产出迁移计划；「执行整理计划」→ `executeIntake`（真正 move/archive/加标签，**执行前需批准**） |
| 输入 | 往 `_inbox/` 放几个文件（含一个名字模糊的、一对重复的）；先让它勘查出计划，再让它执行 |
| 期望 | organizer 产出 intake-plan（分类/重命名/去重建议，此阶段不动文件）；确认后 executeIntake 落地；执行完提示跑语义刷新 |
| Studio 可完成 | 勘查可以；**执行这步同样受审批门控——依赖第 7 项** |
| 结果 | ☐ |

## Cap 4 — 对话沉淀 capture

| 项 | 内容 |
|---|---|
| 入口 | 对话「这段值得保存」→ `proposeChange(capture)` |
| 输入 | 跟 agent 聊出一个判断/原则，说「把这条存进药柜」 |
| 期望 | 创建一条 capture proposal（不直接写人类层）；批准后写成笔记 + 更新索引/向量/语义层 |
| Studio 可完成 | 创建 proposal 可以；**落地依赖第 7 项** |
| 结果 | ☐ |

## Cap 5 — 语义维护（跨全库去重/合并/canonical）

| 项 | 内容 |
|---|---|
| 入口 | `listDuplicateClusters` / `listMaintenanceFindings` / `listCanonicalCandidates`（对话调用）；解决走 merge / canonical_note / archive proposal |
| 输入 | 问「有哪些内容需要维护 / 有重复吗 / 哪些概念该提炼成规范笔记」 |
| 期望 | 列出重复簇、被取代待归档、散落概念候选；每条 finding 能映射到解决它的 proposal |
| Studio 可完成 | 列举可以；**解决动作依赖第 7 项** |
| 结果 | ☐ |

## Cap 6 — 知识画像 + 体系视图

| 项 | 内容 |
|---|---|
| 入口 | `readKnowledgeProfile` / `generateKnowledgeView`（对话）；`refresh-profile` workflow 重建画像 |
| 输入 | 问「我的知识体系如何」；再让它「生成一个 XX 体系视图」 |
| 期望 | 返回常驻画像（含 stale 标记）；按需生成体系视图 markdown |
| Studio 可完成 | 可以（纯读 + 生成，无写门控） |
| 结果 | ☐ |

## Cap 7 — 审批闭环 governance ⚠️ 关键项

| 项 | 内容 |
|---|---|
| 入口 | 任一写操作触发 proposal（capture / move / merge / archive / canonical / executeIntake）；`listPendingChanges` 查看，approve/reject 才生效；`listOperations` 审计 |
| 输入 | 触发一个 capture 或 inbox 执行 → 观察 Studio 是否弹出/暂停等待审批 → 分别 approve 一次、reject 一次（reject 时能否带理由？） |
| 期望 | 写操作暂停等待决定 → 用户 approve → 落地；decline → 文件不动 |
| **实测（2026-07-06）** | ✅ Studio 原生审批机制可用：`requireToolApproval`/`requireApproval` 触发 `finishReason:"suspended"`；`GET /suspended-runs` 列出；`POST /approve-tool-call` 后工具执行并 resume；前端 bundle 含 approve/decline UI。**`executeIntake`（inbox 执行）在 Studio 能审批落地。** |
| ⚠️ 接线缺口 | 批准/落地 proposal 的 `resolveProposalTool` **未挂到 apothecaryAgent、也未注册成 workflow** → Studio 里能 `proposeChange` 建提案，但没有入口 approve/apply。**Cap4 capture / Cap5 维护落地 / proposal 写链在 Studio 走不完。** 修复：把 `resolveProposalTool` 挂到 agent（tool 已存在，含 requireApproval），放宽 instructions 第 3 条。 |
| UX 差异 | Studio 原生 decline 仅 boolean，**捕获不了自由文本拒绝理由**（桌面 reject-reason dialog 补不上，可接受则降级）。 |
| 结果 | ☐ 机制 OK；接线缺口修完再勾 |

---

## 封版判定

- 第 1、2、6 项通过 → 纯读/生成能力 OK。
- 第 3、4、5 项的「列举/勘查」通过，且第 7 项「approve→落地」通过 → 整条写链闭合。
- **第 7 项若 Studio 撑不住**：先判断降级体验能否接受；不能接受则阶段一保留桌面审批壳，其余全部收敛到 Studio。
