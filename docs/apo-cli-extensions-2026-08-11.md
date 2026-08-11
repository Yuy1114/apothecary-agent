# apo CLI 扩展工单：related + day（2026-08-11）

> 状态日期：2026-08-11
> 范围：apothecary-agent 单仓
> 背景：Hermes 对话触发规范（vault-context skill）需要两个轻量接口。本工单与 `voice-english-intake-2026-08-11.md` 独立，可并行。

## 现状（已确认）

`apo ask "<问题>"` 已存在：`src/cli/commands/read.ts:80` 的 `askCommand` → `queryVault(question, topK)`（`src/mastra/tools/rag.ts`），返回 results（source/title/content/supersededBy）。**复用这条检索链路，不新建检索实现。**

## 需求 1：`apo related "<话题>"` — 轻量关联检索

### 用途
Hermes 对话中快速找「跟这个话题相关的笔记标题」，只需要标题+出处，不需要全文片段。比 `ask` 更轻（少传 content，省 token）。

### 行为
- 参数：`<话题>`（必填），`--top-k <n>`（默认 5）
- 实现：复用 `queryVault`（同 ask），输出时**只保留 source + title + supersededBy**，不带 content
- `--json` 输出：`{ topic, results: [{source, title, supersededBy}] }`
- 无结果：`{ results: [] }` + 中文提示「药柜里没有跟「X」相关的笔记」
- 在 `src/cli/commands/read.ts` 加 `relatedCommand`，注册到命令路由（看现有 ask 的注册方式）

### 验收
1. `apo related "排课"` 返回标题列表（无 content 字段）
2. `--json` 结构正确；无结果时返回空数组不报错
3. 与 `ask` 共用同一检索链路（改一处两处生效）

## 需求 2：`apo day <YYYY-MM-DD>` — 某天全记录回看

### 用途
晚间复盘/晨间回顾时，把「某一天发生了什么」一次拉齐：日记 + 语音输入记录。语音数据来自 Type4Me（外部只读，不写入）。

### 行为
- 参数：`<YYYY-MM-DD>`（必填）
- 输出三块（各自可为空，缺哪个如实说哪个）：
  1. **日记**：`journal/YYYY/YYYY-MM-DD Daily Log.md` 是否存在 + 内容摘要（存在才读，用现有 read 逻辑）
  2. **语音记录**：只读 Type4Me 库 `~/Library/Application Support/Type4Me/history.db`（表 `recognition_history`，`created_at` 是 **UTC**，本地=UTC+8，查询时用 `date -u` 换算）——按日期筛出当天的 raw_text 列表（英文/中文都算）
  3. **提案/变更**：当天创建的提案（如现有 proposals 有 created_at 过滤就复用）
- 某块没有 → 如实输出「当日无日记 / 当日无语音记录」，**不编造**
- 注意：Type4Me 库路径对 apo 是外部依赖，读不到时降级为「语音记录不可用（Type4Me 未安装或库不存在）」，不影响其他两块
- 在 `src/cli/commands/read.ts` 加 `dayCommand`，注册到命令路由

### 验收
1. `apo day 2026-08-11` 返回三块（当天有语音记录 + 可能有日记）
2. 语音记录时间换算正确（UTC→本地 +8）
3. Type4Me 库不存在时命令仍成功，语音块显示降级提示
4. 无日记时如实说，不报错

## 文件清单

| 文件 | 动作 |
|---|---|
| `src/cli/commands/read.ts` | 扩展：relatedCommand + dayCommand |
| `src/cli/commands/commands.test.ts` 或新增 test | 扩展：覆盖验收点 |
| `src/cli/index.ts`（或现有命令路由处） | 注册两个新命令 |
| `src/cli/args.ts`（如参数解析在此） | 扩展参数定义 |

## 注意事项

- 只读命令，**绝不写任何东西**（Type4Me 库只读）
- 分层不变：CLI 是 composition root，检索走 rag.ts，日记走现有 vault 读取
- 中文输出给人看，`--json` 给 agent
- 完成前 `npx tsc` + `npx vitest run` 全绿
