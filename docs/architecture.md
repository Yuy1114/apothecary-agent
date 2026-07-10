# 架构说明 / Architecture

> 活文档。描述**当前**的分层契约与端口设计。
> 最后更新：2026-07-10（分支 `refactor/break-layer-cycles`，5 次提交）
>
> `docs/` 下的 `v1-*.md` 是带日期的历史记录，不随代码更新；要看代码现在长什么样，看这里。

## 一句话规则

**依赖只能向下。** 由 `.dependency-cruiser.cjs` 在 `pnpm check` 里强制，违反即 CI 失败。

## 分层

| 层 | 目录 | 职责 | 可以依赖 |
|---|---|---|---|
| 领域 | `domain/` | 纯类型与规则（提案、关系、候选、图谱、diff） | 只有 `zod` / `node:path` |
| 叶子工具 | `utils/` `safety/` `observability/` `protocol/` | 无状态小工具 | `domain/` |
| 本地配置 | `config/` | 路径解析、配置文件读写 | 上面两层 |
| 基础设施 | `vault/` `artifacts/` `reports/` | 磁盘、YAML、Markdown 渲染 | 上面三层 |
| 用例 | `application/` + `application/ports/` | 编排；不认识任何框架 | 上面四层 + 自己的端口 |
| 框架适配 | `mastra/` （`agents/` `tools/` `workflows/` `adapters/`） | Mastra agent / tool / workflow，以及端口的实现 | 全部 |
| 外壳 | `desktop/` | Electron，组合根 | 全部 |

`acceptance/` 是端到端测试，不参与分层。

## 端口（application/ports/）

用例需要 LLM 或向量索引时，**不 import 具体实现**，而是声明一个接口，由 `mastra/adapters/` 实现，在组合根装配。

| 端口 | 文件 | 实现 | 注入方式 |
|---|---|---|---|
| `SearchIndexPort` | `ports/searchIndex.ts` | `adapters/ragSearchIndex.ts` | 注册表 |
| `SummarizeFile` | `ports/fileSummarizer.ts` | `adapters/mastraFileSummarizer.ts` | 注册表 |
| `KnowledgeViewWriter` | `ports/knowledgeViewWriter.ts` | `adapters/mastraKnowledgeViewWriter.ts` | 显式传参 |
| `ReviewerModel` | `review/reviewerModel.ts` ※ | `adapters/mastraReviewerModel.ts` | 工厂 |

※ 历史原因，这个端口没放在 `ports/` 里，见下方「已知瑕疵」。

### 什么时候用注册表，什么时候显式传参

这是本项目唯一需要判断的地方：

- **显式传参** —— 当这个用例的**所有调用方都在基础设施层**时。
  例：`generateKnowledgeView(topic, writer)`，唯一调用方是 `mastra/tools/generate-knowledge-view.ts`，由它把 adapter 递进去。这是首选，依赖显式可见。

- **注册表**（`setX()` 在组合根装、`x()` 在用例里惰性取）—— 仅当端口被 application **内部深处**需要、中间没有基础设施调用方可以递手时。
  例：`SummarizeFile` 会被 `manualSync` / `resolveProposal` / `semanticRecovery` 一路传到 `syncSemanticsForPaths`，要显式传就得改 6 个签名，还会让 `manualSync({ vaultPath })` 这种干净的用例签名挂上一个 LLM 参数。

  注册表本质是 service locator，代价是依赖变隐式、未装配时才在运行期报错。所以它**没装配就抛异常**（不静默降级），并且只允许存在于 `application/ports/`。这个做法沿用了仓库里早就有的 `setVectorStore()`。

### 组合根

两个入口，各调**一次** `installPorts()`：

- `src/mastra/index.ts`（Studio）
- `src/desktop/runtime.ts`（Electron）

```ts
installPorts(vectorStore);   // src/mastra/adapters/installPorts.ts
```

「装配端口」是一个内聚的职责，不要在根里散着写 `setX()`——加第四个注册表端口时，只改一个根就会漏。向量库也一起在这里注入：`ragSearchIndex` 委托给 `rag.ts`，没有向量库它答不了查询，这是一个决定不是两个。

显式传参的端口（`KnowledgeViewWriter`、`ReviewerModel`）在各自调用点递交，不进 `installPorts`。

覆盖情况：`desktop/runtime.test.ts` 真实驱动 Electron 根；`mastra/adapters/installPorts.test.ts` 直接测这个函数。Studio 根没法在测试里驱动（它的模块体会对真实 vault 跑一次 manualSync），但它调的是同一个函数——**唯一没被覆盖的是「某个根压根没调 installPorts」，那是一行显眼的代码，不是三行**。

## 适配器（mastra/adapters/）

一个文件如果是「拼 prompt → 调 agent → 校验结构化输出 → 映射成 domain 类型」，**它是适配器，不是用例**，哪怕名字叫 `generateXxx`。它属于 `mastra/adapters/`。

`mastraDuplicateClassifier` / `mastraKnowledgeProfileWriter` / `mastraFileSummarizer` / `mastraReviewerModel` / `mastraKnowledgeViewWriter` 都是这样从 `application/` 迁回来的。

判据：把 LLM 换成一个确定性实现之后，这个文件还剩下什么？如果什么都不剩，它就是适配器。

## 怎么加东西

**加一个用例**：写在 `application/<领域>/`，只 import `domain/` `vault/` 和自己的端口。

**用例需要一个新的外部能力**（LLM、网络、索引）：
1. 在 `application/ports/` 声明接口，只用 domain 类型描述输入输出；
2. 在 `mastra/adapters/` 写实现；
3. 按上面的规则选注入方式；如果是注册表，两个组合根都要装；
4. 测试里装一个 fake，**不要用 `vi.mock()`**。

**加一个 Mastra tool**：`mastra/tools/` 只放 `createTool()` 薄包装，业务逻辑在 `application/`。

## 强制机制

```bash
pnpm run check         # tsc × 2 + 分层守卫
pnpm run check:layers  # 只跑守卫
```

七条规则。三条是**补救型**——重构前确实被违反过：

| 规则 | 重构前的违规 |
|---|---|
| `domain-is-pure` | `domain/reorgPlan.ts` → `mastra/tools/vault-structure.ts` |
| `application-not-framework` | 6 个文件，共 9 条边 |
| `foundation-not-infra` | `config/vaultAgentConfig.ts` → `vault/ignore.ts` |

另外四条是**预防型**——没被违反过，但边界值得守：`no-circular` · `no-mastra-package-in-application` · `infra-not-upward` · `ports-declare-nothing-concrete`。

### 层级的环 ≠ import 的环

重构前 `application` 和 `mastra` 互相依赖（19 条去、9 条回），是**目录层级**的环。但把 `no-circular` 拿到当时的 `main` 上跑，**零违规**——因为没有任何一组模块首尾相接成闭环。

所以 `no-circular` 抓不到分层腐坏。它是必要的，但远不充分；真正干活的是那些显式的层规则。别指望加一条 `no-circular` 就算有了架构约束。

### ⚠️ `tsPreCompilationDeps` 必须保持 `true`

关掉它，dependency-cruiser 看的是**编译后**的依赖图，而 `import type` 在那时已被抹掉。重构前四个缺陷里就有一个恰恰是 type-only import：`domain/reorgPlan.ts` 从当时的 `mastra/tools/vault-structure.ts`（现 `vault/structureStore.ts`）里 `import type { VaultStructure }`。关掉它，这条边永远抓不到。

**泄漏一个类型就是泄漏一个依赖**：运行期没有耦合，编译期有。

另：一条永远匹配不到的规则也会显示「通过」。改动规则后，请故意注入一个违规，确认它真的会失败。

## 已知瑕疵

- `ReviewerModel` 端口在 `application/review/`，不在 `application/ports/`。它和 `reviewerContext.ts` 都只依赖 domain，搬得动，只是还没搬。
- `DeterministicReviewerModel`（327 行，实现了 `ReviewerModel`）**除了自己的单测没有任何调用方**。`defaultVaultAgentConfig` 里的 `reviewer.provider` 本该用来在它和 Mastra 实现之间切换，但 `createReviewerModel(_config?)` 忽略了这个参数——开关从未接上。
- `src/desktop/ui/` 被排除在守卫之外；`App.tsx` 有 1305 行，是个上帝组件。
- `application/notes/moveVaultFile.ts` 是 application 层唯一没有测试的行为文件。

以上都记在 [`refactor-backlog.md`](./refactor-backlog.md)。
