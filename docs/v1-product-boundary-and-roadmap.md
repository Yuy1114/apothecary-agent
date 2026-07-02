# Apothecary Agent v1 Product Boundary and Roadmap

## 一句话定位

Apothecary Agent v1 是一个本地个人知识库维护 agent。它维护一个双层药柜：人类阅读层保持清晰的 Markdown 文件结构，agent 理解层持续分析文件主旨、概念、主题与关系，并基于这层语义结构提供 RAG 问答、inbox 归位、变更同步、知识体系概述和整理建议。真实文件的移动、合并、归档需要用户确认。

## 背景：没有 agent 时的真实痛点

### 1. 新知识进入药柜的决策成本高

学习、项目推进、对话和外部资料会不断产生高价值内容，但每次沉淀都要手动判断：是否值得保存、存到哪里、新建还是追加、是否更新索引、是否关联已有概念。成本过高会导致重要 insight 滞留在聊天或临时文件里。

### 2. `inbox/` 不是简单暂存区，而是需要理解后归位

外部放入 `inbox/` 的文件需要被理解：主题、长期项目、资料类型、目标目录、是否拆分/重命名、是否更新 README/index。没有 agent 时，`inbox/` 容易从待处理区变成半永久堆积区。

### 3. 文件增加会稀释个人知识画像

旧文件、重复内容、过期观点、散落 insight 会增加检索噪音和上下文重建成本。用户真正需要的不是文件数量最少，而是用最少的重复内容维持最清晰、最可追溯的个人知识画像。

### 4. 手动 CRUD 不会自动进入知识系统

用户会直接修改、移动、新增、删除药柜文件。没有 change awareness 时，这些只是文件系统变化，不会触发索引刷新、知识画像更新、过期关系清理或维护建议。

### 5. 对话是知识产生主场，但药柜不会自动吸收

很多关键判断来自对话，例如项目定位、工程原则、学习总结、岗位证据表达。如果没有 capture workflow，这些内容不会进入长期知识系统。

## 核心产品承诺

Apothecary Agent v1 解决的不是“搜索文件”，而是：

> 持续维护药柜的高信噪比个人知识画像。

聊天、RAG、inbox triage、文件同步和整理建议都是这个承诺下的入口或手段。

## 双层药柜架构

### 1. Human-readable Physical Layer（人类阅读层）

真实 Markdown 文件结构，优先服务人类阅读、浏览、手动查找和编辑。

关注点：

- 目录层级是否直观；
- 文件名是否清楚；
- README/index 是否能导航；
- 项目、学习、职业、日记等人类上下文是否保留；
- 文件是否适合长期阅读。

原则：

- 真实目录结构优先服务人类阅读；
- agent 不应为了自身检索便利重排人类目录；
- move / rename / merge / archive / split / edit 用户文件必须通过 proposal 并经用户确认。

### 2. Agent Semantic Layer（agent 理解层）

agent 自己维护的语义结构，写在 `.agent/` 下，不直接改变用户笔记。

目标：让 agent 知道每个文件讲什么、和哪些主题/概念相关、是否重复/过期/演化、如何支撑某个知识体系或岗位证据。

候选 artifact：

```text
.agent/semantic/file-summaries.json
.agent/semantic/topics.json
.agent/semantic/concepts.json
.agent/semantic/relations.json
.agent/semantic/duplicate-clusters.json
.agent/semantic/canonical-candidates.json
.agent/profile/knowledge-profile.md
.agent/profile/knowledge-profile.json
```

可能的节点：

- File
- Topic
- Concept
- Claim
- Insight
- Project
- Source
- Decision
- Question

可能的关系：

- contains
- related_to
- supports
- contradicts
- supersedes
- duplicates
- extends
- applies_to
- evidence_for
- derived_from

原则：

- agent 理解层可以自动更新；
- 它服务 RAG、知识体系生成、重复检测、inbox 分类和维护建议；
- 它不等同于人类目录结构。

### 3. Knowledge System View（知识体系呈现层）

基于 agent 理解层按任务动态生成的人类可读视图。

示例：

- AI 应用工程体系；
- 产品型工程师体系；
- Apothecary Agent 架构体系；
- do-together 岗位证据体系；
- Frank 工程闭环体系。

视图内容可以包括：

- 体系概述；
- 核心主题；
- 关键概念；
- 概念关系；
- 来源文件；
- 当前缺口；
- 推荐阅读顺序；
- 可沉淀到人类阅读层的建议。

原则：

- semantic layer 是底层图；
- knowledge system view 是按问题生成的视图，不是一棵唯一固定大树；
- 默认写入 `.agent/views/`，用户确认后才沉淀进普通 vault 文件。

## v1 功能边界

### Capability 1: Chat with Vault / Knowledge Capture

解决痛点：对话和临时想法难以进入长期知识系统。

v1 做：

- 提供聊天入口；
- 基于药柜进行 RAG 问答；
- 回答时引用来源文件；
- 从对话中识别 durable insight；
- 生成保存 proposal，说明建议位置和理由；
- 用户确认后写入人类阅读层；
- 更新索引和 agent 理解层。

v1 不做：

- 自动保存所有聊天；
- 把临时想法默认当作长期知识；
- 无确认写入用户笔记；
- 构建复杂聊天产品 UI。

### Capability 2: Inbox Triage

解决痛点：`inbox/` 堆积，内容需要理解后归位。

v1 做：

- 扫描 `inbox/`；
- 理解 Markdown / txt 文件；
- 根据 `.agent/structure.yaml` 和 semantic layer 判断目标位置；
- 生成 move / rename / append-index proposal；
- 用户确认后移动文件；
- 更新 README/index、向量索引、file summary 和 relation。

v1 不做：

- 深度 PDF/OCR/多模态理解；
- 无确认批量移动；
- 为清空 inbox 而牺牲分类质量；
- 自行发明一套完全不同的人类目录结构。

### Capability 3: Change Awareness / Sync

解决痛点：用户手动 CRUD 后，系统不知道知识状态变化。

v1 做：

- watcher 记录 created / modified / deleted；
- 提供手动 sync 作为 watcher 的补偿；
- 维护 pending change queue；
- 对变化触发 reindex；
- 对受影响文件刷新 file summary 和 semantic relations；
- 标记需要 agent review 的变化。

v1 不做：

- 完美识别所有 rename/move；
- 实时强一致；
- 替代 git 或完整版本历史系统。

### Capability 4: Semantic Maintenance

解决痛点：重复、过期、散落内容稀释知识画像。

v1 做：

- 扫描全库；
- 维护 file summaries、topics、concepts、relations；
- 识别重复、过长、过期、散落、分类不一致；
- 区分 harmful duplicate、contextual repetition、evolutionary duplicate；
- 生成 edit / merge / archive / canonical-note proposal；
- 用户确认后执行小规模整理。

v1 不做：

- 全自动 physical restructure；
- 永久删除用户文件；
- 一键重构整个 vault；
- 为 agent index 便利而拆碎人类笔记。

### Capability 5: Knowledge Profile and System Views

解决痛点：药柜没有持续表达当前的个人知识画像。

v1 做：

- 维护 `.agent/profile/knowledge-profile.md/json`；
- 总结当前主题、项目、概念、证据材料、重复区、薄弱区；
- 支持按问题生成 knowledge system view；
- 为 RAG、capture、maintenance 提供高层上下文。

v1 不做：

- 职业规划系统；
- 学习计划系统；
- 完整知识图谱 UI；
- 自动评价人格或能力。

### Capability 6: Governance and Audit

解决痛点：AI 修改用户资产必须可信、可审阅、可追踪。

v1 做：

- 统一 proposal 概念；
- 记录 approval / rejection / apply 结果；
- 维护 operation ledger；
- 记录每次改动影响的文件、原因、来源和时间；
- 永久删除设为 deny。

v1 不做：

- 无审计写入；
- 无确认危险操作；
- 自动清理用户资产。

## Proposal 类型

v1 中，agent 想改变人类阅读层时必须生成 proposal。

候选类型：

- `capture_proposal`：从对话沉淀 insight；
- `move_proposal`：移动 inbox 或错位文件；
- `edit_proposal`：修改已有文件内容；
- `merge_proposal`：合并重复或高度重叠文件；
- `archive_proposal`：归档低价值或被吸收内容；
- `canonical_note_proposal`：创建或更新某个概念的 canonical note；
- `structure_proposal`：更新 `.agent/structure.yaml` 的分类规则、关键词或 alias；
- `view_promotion_proposal`：将 `.agent/views/` 中的临时知识体系视图沉淀为普通 vault 笔记。

## 重复内容处理原则

v1 不把所有重复都当作坏事。

### Harmful Duplicate

同一内容被复制到多个位置，且没有新的上下文价值。

处理：合并、归档副本、保留来源记录。

### Contextual Repetition

同一概念在不同项目/学习/职业上下文中被使用。

处理：保留上下文，建立或更新 canonical note，添加引用关系。

### Evolutionary Duplicate

旧观点与新观点形成思想演化。

处理：保留演化链，标记 superseded，知识画像采用当前观点。

## Canonical Note 原则

Canonical Note 是某个长期概念或主题当前最权威的表达。

目标不是把所有内容都合并到 canonical note，而是：

- 重要概念有当前清晰表达；
- 项目、日记、学习中的上下文仍然保留；
- source/evidence 可追溯；
- 旧观点可以标记为 superseded；
- RAG 可以优先使用 canonical note，同时引用上下文来源。

## v1 明确非目标

- 替代 Obsidian 或完整笔记编辑器；
- 自动大规模重排真实目录；
- 永久删除用户文件；
- 深度 PDF/OCR/图片/音视频理解；
- 多用户、云同步、团队协作；
- 完整前端产品或复杂图谱 UI；
- 学习计划、复习系统、课程系统；
- 通用文件管理器。

## v1 核心闭环

```text
新知识 / 新文件 / 手动改动
        ↓
agent 感知变化
        ↓
更新 agent 理解层
        ↓
理解它对知识画像的影响
        ↓
生成可审阅 proposal 或 knowledge system view
        ↓
Yuy 确认需要修改的动作
        ↓
安全应用到人类阅读层
        ↓
更新索引、ledger、profile、semantic layer
```

## 推进大纲

### Phase 1: Semantic Layer Foundation

目标：先让 agent 能稳定理解文件，而不是先移动文件。

交付：

- file summary schema；
- topic / concept / relation schema；
- affected-file refresh；
- `.agent/semantic/` artifact 写入；
- RAG 能利用 file summary 和 relation 做上下文扩展。

验收：

- 对任意 Markdown 文件，agent 能生成稳定摘要、主题、概念；
- 修改文件后，只刷新受影响 semantic artifacts；
- RAG 回答能引用来源并说明相关主题。

### Phase 2: Change Awareness and Sync

目标：让手动 CRUD 成为 agent 的一等输入。

交付：

- watcher 去重/补偿；
- manual sync；
- snapshot diff；
- pending change queue；
- created / modified / deleted 处理；
- reindex + semantic refresh 串联。

验收：

- 手动新增/修改/删除文件后，pending changes 能准确显示；
- 手动 sync 能补偿 watcher 漏事件；
- 变化处理后，索引和 semantic layer 更新。

### Phase 3: Capture and Inbox Triage

目标：解决新知识进入药柜和 inbox 堆积。

交付：

- chat insight capture proposal；
- inbox scan；
- classification using structure + semantic layer；
- move proposal；
- confirmed apply；
- README/index update；
- apply 后 reindex + semantic refresh。

验收：

- 对话中的 durable insight 能生成保存建议；
- inbox Markdown/txt 能生成合理归位建议；
- 用户确认后文件被正确写入/移动，索引和语义层同步。

### Phase 4: Knowledge Profile and System Views

目标：让药柜可以表达当前知识画像，并按问题生成知识体系概述。

交付：

- `.agent/profile/knowledge-profile.md/json`；
- `.agent/views/`；
- topic system overview generator；
- gaps / reading path / source files；
- view promotion proposal。

验收：

- 用户询问某个方向时，agent 能生成结构化知识体系视图；
- 每个主题有概述、来源、缺口；
- profile 能反映当前核心项目、主题和薄弱区。

### Phase 5: Maintenance Proposals

目标：从理解层出发，提出小规模、可审阅的真实文件整理建议。

交付：

- duplicate cluster detection；
- stale/superseded detection；
- canonical note candidate；
- edit / merge / archive proposals；
- operation ledger；
- apply 后 semantic refresh。

验收：

- agent 能区分 harmful duplicate / contextual repetition / evolutionary duplicate；
- proposal 说明原因、影响文件、风险和预期结果；
- 用户确认后执行，且留下审计记录。

## 后续 v1.5 / v2 方向

### v1.5: Canonicalization

- 系统化识别 canonical note candidates；
- 建立 source references；
- 把散落 insight 汇总为当前权威表达；
- 保留项目/学习/日记上下文。

### v2: Controlled Vault Restructure

- 生成全库 restructure plan；
- 展示 affected files、diff、rollback plan；
- 分批 apply；
- 每批需要用户确认；
- 不以 agent 检索便利牺牲人类阅读层。

## 工程叙事

### 应用型工程师视角

这个项目证明：围绕真实个人知识管理痛点，设计了一个有输入、理解、确认、执行、反馈的完整产品闭环。重点是低成本沉淀、inbox 工作流、变更追踪、安全维护和高信噪比知识画像。

### AI 应用工程师视角

这个项目证明：构建的不是普通 RAG demo，而是一个带 semantic layer、tools、workflows、HITL、audit、change awareness、knowledge profile 的本地 AI agent 应用。RAG 是上下文层，proposal 是行动边界，semantic layer 是长期理解资产。
