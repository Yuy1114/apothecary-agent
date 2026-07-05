# 重构待办 / Refactor Backlog

延后处理的重构点。每条记录：现象/根因、目标设计、复用与丢弃、当前状态。
新点子往上加，注明日期。

---

## 1. intake 分类：从「子 agent 逐文件工具循环」→「workflow + structuredOutput 批量分类」

**记录于 2026-07-05｜状态：延后，当前保持子 agent 方案不动**

### 现象 / 根因
- 冷启动整理 `_inbox`（约 270 个文件）时「感觉卡住」。
- 实测不是坏了：一轮记了 **259 条决策**（move 208 / archive 49 / leave 2），dest 全部合法。**分类逻辑是对的。**
- 「卡住」的根因是 **organizer 子 agent 逐个文件调 `recordDecision` 工具 = 259 次串行 LLM 往返**——慢，且容易撞 `maxSteps` 上限（270 个只跑到 259）。

### 为什么形状错了（对着 Mastra v1.48 文档核实过）
- **Supervisor + 子 agent 是 Mastra 推荐**，但用于**多 agent 协作**（不同专长配合），不是「把一个工具调 259 次」。这里**过度套用**了。
- 「一次分类一大批」的 Mastra 惯用法是 **structured output 返回数组**（`docs-agents-structured-output.md` 首例即 `schema: z.array(...)`）：**一次 `generate` 返回全部决策**。现有 4 个转换器都在用 structuredOutput，只是返回单条。

### 目标设计
把 intake 从「会话式子 agent 工具循环」改成「确定性 workflow + 一次结构化分类」（仿 `refreshSemanticsWorkflow`）：
```
intakeWorkflow:
  survey    surveyInbox()                    → 树+名字
  classify  generate + structuredOutput: z.array(IntakeDecision)  → 一把返回全部决策
  write     代码批量写 intake-plan（不再逐条调工具；dest 校验作落库前过滤）
  deepen?   仅对模型标 needsContent 的少数，读内容后再来一次 array 分类
```
- **1～3 次 LLM 调用**，非 259 次。快、稳、可续跑。
- apothecary 仍是唯一入口，用一个 `organizeInbox` 工具触发该 workflow（仿现有 `manualSync` 工具包 workflow）。

### 复用 / 丢弃
- **复用**：`surveyInbox`、organizer 的分类 prompt（改成 classifier 的 system）、`intakePlanStore`（改成批量写）、`recordDecision` 的 dest 校验逻辑（`classifyLayer`）。
- **丢弃**：organizer 子 agent 的逐文件工具循环；`recordDecision` 工具本身可能不再需要（改为 workflow 内批量落库）。
- **可能连带**：apothecary 若无其他真正的子 agent，`agents: { organizer }` 可移除（supervisor 模式留给将来真需要多 agent 协作时）。

### 当前状态（保持不动）
- organizer 子 agent + surveyInbox/readInboxFile/recordDecision + apothecary 委派，均已实现并能跑通（就是慢）。
- 已修的相关 bug 保留：dest 越界校验、intake-plan 串行原子写、prompt 里「骨架固定/不发明 .apothecary//旧产物归档/只用 recordDecision」、apothecary 移除 readStructure。

---

## 4. intake 执行的两个边界情况（首次真实运行暴露）

**记录于 2026-07-05｜状态：延后**

- **LLM 复述路径会走样特殊字符**：一张文件名含弯引号 `“…”` 的图片执行时 `missing_source`——organizer 把路径重打给 recordDecision 时引号变了字节。文件安全（没动）。根治方向：organizer 用 surveyInbox 给出的**索引/ID 引用文件**，而不是重打完整路径；或 executeIntake 做一次规范化/模糊匹配兜底。与 #1 的 structuredOutput 重构一起做最自然（decision 里带 survey 的稳定 id）。
- **junk 聚合决策无法执行**：organizer 对 `.DS_Store` 用「整体 archive」的聚合决策（source 不是真实路径），executeIntake 落不了地，垃圾留在 _inbox。方向：executeIntake 增加「按规则清理 junk」（或 surveyInbox 把 junk 路径逐个给出、executeIntake 支持 glob/批量 archive）。

---

## 2. structure.yaml 老机制清理（legacy）

**记录于 2026-07-05｜状态：延后**

骨架 realign 后，旧的 `.agent/structure.yaml` 关键词→目录路由已被「固定 PARA 骨架 + organizer 按内容分类」取代，`structure.yaml` 恒为空。但相关代码仍在：`vault-structure.ts`、`read-structure` 工具（已成孤儿）、`classifyWithStructure`、proposal 的 `structure` 类型、ingest 的 `resolveIngestDir`（capture 流仍在用 `loadStructure`，空则落 inbox）。应整体清一次，或把 capture 的分类也并入骨架逻辑。

---

## 3. 自建 proposal 系统 → Mastra 原生 tool approval 收敛

**记录于 2026-07-05｜状态：延后（与在飞的 proposal suspend/resume WIP 咬合，勿贸然动）**

`proposalStore`/`resolveProposal` + 桌面审批队列，与 Mastra 原生 `requireApproval` / `suspend()` / `listSuspendedRuns()`（审批沿 supervisor→人冒泡）功能重叠。`propose-change.ts` 其实已在用原生 `suspend()`。可收敛到原生审批 + `listSuspendedRuns` 做桌面待办列表，去掉自建队列。
