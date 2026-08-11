# 口语英语学习流接入（Type4Me → 药柜）— 开发工单

> 状态日期：2026-08-11
> 范围：apothecary-agent 单仓
> 需求方：Yuy（Ivy 协助定义）
> 执行方：Claude Code（按本工单实现，不超范围）

## 背景

Yuy 用 Type4Me（macOS 语音输入法，火山豆包 ASR）说英语，语音记录存 `~/Library/Application Support/Type4Me/history.db`（表 `recognition_history`，字段 `created_at`(UTC) / `raw_text` / `processed_text` / `processing_mode`）。

Hermes cron（每晚 20:00）读取当日记录 → 逐句纠错 → 调 `apo capture --topic notes/英语` 生成「英语口语复盘」提案 → Yuy 批准 → 落盘 `notes/英语/`。

**本工单只做 apo 侧缺口**。Hermes cron 已上线，不在此范围。

## 现状（已确认，勿重复开发）

| 能力 | 位置 | 状态 |
|---|---|---|
| capture 提案流（起草→审批→落盘） | `src/cli/commands/propose.ts` + `src/application/proposals/` | ✅ 现成 |
| 落盘后语义索引自动刷新 | `resolveProposal.ts:276` → `syncSemanticsForPaths` | ✅ 现成，复盘笔记存进 `notes/英语/` 即可被 `apo ask` 检索 |
| 阅读模式英文捕获（剪贴板→查词→Anki） | `src/domain/englishCapture.ts` + `src/application/english/ingestCapture.ts` + `ankiConnect.ts` | ✅ 现成，**仅覆盖剪贴板来源** |

## 缺口 1：口语学习点进 Anki 记忆流（开发）

### 问题

晚间复盘产出的纠错内容（地道表达、易错搭配）目前只落盘为 markdown 笔记，**没有进入 Anki 复习队列**。阅读模式有 `ingestCapture`（剪贴板 → 查词 → 激活/建卡），但口语来源无入口。

### 方案

新增口语纠错 → Anki 的导入入口，**复用现有 Anki 基建**（`ankiConnect.ts` 的 `addNote/addTags/unsuspendCards`，deck 用 `CS Vocabulary`，model 用 `Basic`），不改动阅读模式链路。

- 新增 `src/application/english/ingestSpeech.ts`：
  - 输入：一条纠错记录 `{ rawText, correctedText, note(中文说明), source: "type4me", capturedAt }`
  - 动作：`addNote` 建卡。正面 = 地道说法（`correctedText` 里的关键表达），背面 = rawText + 中文说明
  - 打 tag：`口语`（新）+ `apothecary`（沿用）
  - Anki 未开时返回 `deferred`，与 `ingestCapture` 同款语义
- 复用 `src/vault/englishCaptureLog.ts` 的排队机制：口语记录先落队列文件，drain 时统一处理（与阅读模式一致，Anki 关了不丢）
- **不做**：语法拆解（sentence breakdown 仍是 `awaiting breakdown`，本工单不建）；不新建 deck/model

### 验收

1. `ingestSpeech` 对一条纠错记录：Anki 开着 → 建卡成功、正面是地道表达、背面含原句和中文说明、tags 含 `口语` 和 `apothecary`
2. Anki 关着 → 返回 `deferred`，记录留在队列，下次 drain 补上
3. 阅读模式 `ingestCapture` 行为不变（回归测试通过）
4. 单测覆盖：建卡路径、deferred 路径、tag 正确性

## 缺口 2：复盘笔记格式规范（开发，轻量）

### 问题

cron 写入的复盘笔记目前是自由 markdown，无法按「日期/错误类型」结构化检索。

### 方案

在 `src/domain/` 定义复盘笔记的 frontmatter 契约 + 校验（纯函数，可测）：

```
---
type: english-review
date: 2026-08-11
sentences: 3
topics: [tense, preposition]
---
```

- `topics` 是 Hermes 侧写入的纠错类别（tense/word-choice/preposition/pronunciation/…），本工单只定义 schema 和校验函数，**不负责生成**（生成在 Hermes cron，另行对齐）
- 校验函数：`parseEnglishReviewFrontmatter(md) → { ok } | { ok: false, reason }`，不合法时返回原因不抛异常
- 放 `src/domain/englishReview.ts`，纯函数，无 IO

### 验收

1. 合法 frontmatter 解析通过；缺 `date`、`type` 不是 `english-review`、`topics` 非数组 → 分别返回具体原因
2. 单测覆盖以上分支

## 不做（明确排除）

- 语义索引/检索：已现成（落盘自动刷新）
- Hermes cron 本身：属 Hermes 侧，不在本仓
- 热词管理（Type4Me 词汇表）：有官方配套 skill，不并入 apo
- 语法拆解（sentence breakdown）：独立 backlog 项

## 文件清单

| 文件 | 动作 |
|---|---|
| `src/application/english/ingestSpeech.ts` | 新增（缺口 1 核心） |
| `src/application/english/ingestSpeech.test.ts` | 新增 |
| `src/vault/englishCaptureLog.ts` | 扩展（口语记录队列类型，若现结构可复用则不动） |
| `src/domain/englishReview.ts` | 新增（缺口 2 契约 + 校验） |
| `src/domain/englishReview.test.ts` | 新增 |

## 注意事项

- 遵循仓库现有分层：domain 纯函数无 IO，application 调外部（Anki），CLI/desktop 是 composition root
- Anki 相关常量（deck/model）与 `ingestCapture.ts` 保持一致，不另起炉灶
- 项目文档/注释用中文，代码标识符用英文
- 完成前跑 `npx tsc` + `npx vitest run`（或仓库现有测试命令），全绿才算完
