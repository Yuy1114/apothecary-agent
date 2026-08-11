/**
 * Argument parsing, kept separate from the entry point so it is testable
 * without executing the CLI (importing `index.ts` runs it).
 *
 * The command surface is grouped by permission, and that grouping is the point:
 * `status`/`proposals`/`ask`/`related`/`day`/`findings`/`journal`/`anki` only read, and
 * `intake`/`capture`/`audit`/`polish` only ever produce an approvable proposal.
 * Nothing here can change the vault — approving is a human action and has no
 * command. `speech ingest` 写的是 Anki（药柜之外），不属于这个约束。
 */

export const HELP = `apo — apothecary 的无界面入口（供 Hermes / 脚本调用）

只读命令（不改任何东西）
  apo status                      待审提案 / 收件箱 / 变更队列 / 复盘 / 画像 的一次快照
  apo proposals list              列出待审提案
  apo proposals show <id>         单条提案详情（含 targetFiles 与 payload）
  apo ask "<问题>"                 检索药柜并返回带出处的片段
  apo related "<话题>"             轻量关联检索：只返回相关笔记的标题与出处，不带内容片段
  apo day <YYYY-MM-DD>            某天全记录回看：日记摘要 + Type4Me 语音记录 + 当天提案
  apo findings                    维护清单：被取代的笔记、散落的概念
  apo journal today|yesterday     当期日记：计划条目与复盘状态
  apo anki due                    今日到期卡片数与断更天数

提案命令（只起草，永不落盘；改动仍需你批准）
  apo intake plan                 勘查 _inbox 并起草归位提案
  apo capture "<内容>" [--topic X] 把一段内容存成 capture 提案
  apo audit readme                README 与实际文件对不上的地方 → 编辑提案
  apo polish <path> --mode <m>    重写一篇笔记 → 编辑提案（m: expand|format|tags，可重复）

给定时任务用
  apo brief                       先扫 _inbox 起草归位提案，再报出所有等你处理的事
                                  一条命令搞定「早上告诉我欠什么」，顺序固定不会搞反
  apo schedule [<YYYY-MM-DD>]      生成某天（缺省今天）的日程，落盘到 schedule/<date>.md
                                  并回显日程。唯一会写药柜的命令：日程是派生数据，
                                  不经提案直接落盘（晨间 cron / Hermes 的入口）
  apo speech ingest --raw "<原句>" --corrected "<纠错句>" [--note "<说明>"]
                                  把一条口语纠错送进 Anki（晚间英语复盘 cron 用）：
                                  正面=纠错句里的地道表达，背面=原句+中文说明。
                                  Anki 未开时退出码 1，但 json.kind=deferred
                                  表示记录应保留、下次重试（skipped 则不应重试）

维护命令（只写 agent 自己的目录，不碰药柜）
  apo describe images             用视觉模型读遍药柜里的图片，写进语义层并建索引
                                  之后 apo ask 就能搜到图。按内容哈希去重，重跑不会重复付费。

通用选项
  --json                          输出 JSON（给 agent）；缺省中文摘要（给人）
  --vault <path>                  指定药柜；缺省依次尝试 APOTHECARY_VAULT_PATH、桌面 app 当前药柜、默认路径
  --limit <n>                     findings / proposals 的条数上限；describe images 的本次张数上限
  --force                         describe images：即使内容没变也重新描述
  --top-k <n>                     ask / related 返回的条数（默认 5）
  --raw / --corrected / --note    speech ingest 的三段输入（--note 可省略）
  -h, --help                      显示本帮助

注意：批准提案没有命令。agent 可以把待审项讲给你听，但按下同意的必须是人。
`;

export type ParsedArgs = {
  /** Command and its arguments, e.g. ["proposals", "show", "prop-123"]. */
  positionals: string[];
  json: boolean;
  help: boolean;
  /** Redo work that is already done — currently only `describe images`. */
  force: boolean;
  vault?: string;
  topic?: string;
  /** Repeatable: `--mode expand --mode tags`. */
  modes: string[];
  limit?: number;
  topK?: number;
  /** speech ingest 的输入：原句（必填）。 */
  raw?: string;
  /** speech ingest 的输入：纠错句（必填）。 */
  corrected?: string;
  /** speech ingest 的输入：中文说明（可省略）。 */
  note?: string;
};

const VALUE_FLAGS = new Set([
  "--vault",
  "--topic",
  "--mode",
  "--limit",
  "--top-k",
  "--raw",
  "--corrected",
  "--note",
]);

function positiveInt(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} 需要一个正整数，收到: ${raw}`);
  return value;
}

function applyValue(parsed: ParsedArgs, flag: string, value: string): void {
  switch (flag) {
    case "--vault":
      parsed.vault = value;
      break;
    case "--topic":
      parsed.topic = value;
      break;
    case "--mode":
      parsed.modes.push(value);
      break;
    case "--limit":
      parsed.limit = positiveInt(flag, value);
      break;
    case "--top-k":
      parsed.topK = positiveInt(flag, value);
      break;
    case "--raw":
      parsed.raw = value;
      break;
    case "--corrected":
      parsed.corrected = value;
      break;
    case "--note":
      parsed.note = value;
      break;
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { positionals: [], json: false, help: false, force: false, modes: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }

    const equals = arg.indexOf("=");
    if (arg.startsWith("--") && equals !== -1) {
      const flag = arg.slice(0, equals);
      if (!VALUE_FLAGS.has(flag)) throw new Error(`未知选项: ${flag}`);
      const value = arg.slice(equals + 1);
      if (!value) throw new Error(`${flag} 需要一个值`);
      applyValue(parsed, flag, value);
      continue;
    }

    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      // A following flag means the value was forgotten — `--topic --json` must
      // not quietly set the topic to "--json".
      if (value === undefined || value.startsWith("-")) throw new Error(`${arg} 需要一个值`);
      applyValue(parsed, arg, value);
      i += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      // Unknown flags are an error, not something to ignore: a caller that
      // mistypes `--jsonn` must not silently get human-formatted output.
      throw new Error(`未知选项: ${arg}`);
    }

    parsed.positionals.push(arg);
  }

  return parsed;
}
