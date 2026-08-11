import { ankiConfig } from "../../application/english/ankiConnect.js";
import {
  ingestSpeech,
  type SpeechRecord,
} from "../../application/english/ingestSpeech.js";
import { nowIso } from "../../utils/time.js";
import type { CommandResult } from "./read.js";

/**
 * The speech half of the CLI — 口语纠错进 Anki 的入口。
 *
 * 这是给 Hermes 晚间英语复盘 cron（每晚 20:00 读 Type4Me 语音记录 → 逐句纠错）
 * 用的：一条纠错记录（原句 / 纠错句 / 中文说明）直接送进 Anki 记忆流，不用先
 * 起草提案等人工批准——卡进 Anki 是派生数据（和 `apo schedule` 落盘日程一个
 * 待遇），而且是写药柜之外（Anki 本地库），不在「未经批准不得改药柜」的约束内。
 *
 * Anki 未开（deferred）时返回 exitCode 1：调用方（cron）按 json.kind 判断——
 * deferred 要保留记录、下次再试；skipped 是输入本身有问题，不应重试。
 */

export type SpeechIngestOptions = {
  raw?: string;
  corrected?: string;
  note?: string;
};

/**
 * 解析并执行 `apo speech ingest`。--raw / --corrected 必填（缺失直接报错，
 * 与 capture/day 缺参数的行为一致），--note 可省略。构造 SpeechRecord 后
 * 调 ingestSpeech，把三种结果（created/deferred/skipped）映射成 CommandResult：
 * 只有 created 是成功（exitCode 0），另两种都返回 exitCode 1 让 cron 知道
 * 这次没送进去。
 */
export async function speechCommand(
  options: SpeechIngestOptions,
): Promise<CommandResult> {
  const raw = (options.raw ?? "").trim();
  const corrected = (options.corrected ?? "").trim();
  if (!raw) throw new Error("speech ingest 需要 --raw <原句>");
  if (!corrected) throw new Error("speech ingest 需要 --corrected <纠错句>");

  const record: SpeechRecord = {
    rawText: raw,
    correctedText: corrected,
    note: (options.note ?? "").trim(),
    source: "type4me",
    capturedAt: nowIso(),
  };

  const outcome = await ingestSpeech(record, { config: ankiConfig() });

  switch (outcome.kind) {
    case "created":
      return {
        json: { kind: "created", noteId: outcome.noteId },
        text: `已入 Anki（noteId ${outcome.noteId}）`,
      };
    case "deferred":
      return {
        // json 里带上完整 record：deferred 的调用方要保留记录待下次重试，
        // 有这份原文就不用自己在 cron 侧再存一遍输入参数。
        json: { kind: "deferred", detail: outcome.detail, record },
        text: "Anki 未开，已保留待下次重试",
        exitCode: 1,
      };
    case "skipped":
      return {
        json: { kind: "skipped", detail: outcome.detail },
        text: `未入 Anki：${outcome.detail}`,
        exitCode: 1,
      };
  }
}
