/**
 * Argument parsing kept separate from the entry point so it can be tested
 * without executing the CLI (importing `index.ts` runs it).
 */

export const HELP = `apo — apothecary 的无界面入口（供 Hermes / 脚本调用）

用法
  apo status [--json] [--vault <path>]

命令
  status         一次只读快照：待审提案、收件箱未归位、变更队列、日记复盘、画像状态。
                 不启动 watcher、不写任何数据库、不需要 API key，桌面 app 没开也能跑。

选项
  --json         输出 JSON（给 agent 消费）；缺省输出中文摘要（给人看）
  --vault <path> 指定药柜；缺省依次尝试 APOTHECARY_VAULT_PATH、桌面 app 当前药柜、默认路径
  -h, --help     显示本帮助
`;

export type ParsedArgs = {
  command?: string;
  json: boolean;
  vault?: string;
  help: boolean;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { json: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--vault") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) throw new Error("--vault 需要一个路径参数");
      parsed.vault = value;
      i += 1;
    } else if (arg.startsWith("--vault=")) {
      const value = arg.slice("--vault=".length);
      if (!value) throw new Error("--vault 需要一个路径参数");
      parsed.vault = value;
    } else if (arg.startsWith("-")) {
      // Unknown flags are an error, not something to ignore: a caller that
      // mistypes `--jsonn` must not silently get human-formatted output.
      throw new Error(`未知选项: ${arg}`);
    } else if (!parsed.command) {
      parsed.command = arg;
    } else {
      throw new Error(`多余的参数: ${arg}`);
    }
  }

  return parsed;
}
