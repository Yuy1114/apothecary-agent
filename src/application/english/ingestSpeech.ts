import { addNote, type AnkiConfig } from "./ankiConnect.js";
import { CAPTURE_DECK, CAPTURE_MODEL, CAPTURE_TAG } from "./ingestCapture.js";

/**
 * 口语纠错 → Anki 记忆流。
 *
 * 晚间复盘（Hermes cron，每晚 20:00 读 Type4Me 语音记录 → 逐句纠错）产出的纠错记录
 * 由此进入 Anki 复习队列：正面是 correctedText 里的地道表达（与 rawText 差异处），
 * 背面是原句 + 中文说明，让「我当时怎么说的」和「应该怎么说」在同一张卡上对照。
 *
 * 复用阅读模式的 Anki 基建：ankiConnect 的 addNote、ingestCapture 的 deck/model/tag
 * 常量，不新建 deck/model，也不改动阅读模式 ingestCapture 链路。
 *
 * Anki 未开时返回 `deferred`——调用方（cron 侧）保留记录、下次再试，与阅读模式
 * drainCaptures 的语义一致。本模块刻意不依赖 englishCaptureLog 队列：那个队列的
 * schema（kind ∈ word/phrase/sentence、text/lookup）只服务阅读模式，口语记录
 * （rawText/correctedText/note）塞进去要动表结构和阅读模式链路，扩展成本高，
 * 故 deferred 语义内置在本模块（工单允许：若现结构可复用则不动）。
 */

/** 口语来源专用 tag，与阅读模式的「遇到过」/「apothecary」并列。 */
export const SPEECH_TAG = "口语";

export type SpeechRecord = {
  /** 语音输入识别的原句（Type4Me raw_text）。 */
  rawText: string;
  /** 复盘纠错后的地道表达（Hermes 侧生成）。 */
  correctedText: string;
  /** 中文说明：为什么这么改 / 易错点。 */
  note: string;
  /** 来源标识，目前只有 Type4Me 语音输入。 */
  source: "type4me";
  /** 捕获时间（UTC ISO 字符串）。 */
  capturedAt: string;
};

export type IngestSpeechDeps = {
  config: AnkiConfig;
};

export type IngestSpeechOutcome =
  | { kind: "created"; noteId: number }
  /** Anki 未开（或暂时不可达）——调用方保留记录，下次 drain 再试。 */
  | { kind: "deferred"; detail: string }
  /** 输入本身无法成卡（如没有纠错内容），不应重试。 */
  | { kind: "skipped"; detail: string };

/** 按空白切词，保留标点（卡片上需要原句的句号等）。 */
function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/**
 * 提取 correctedText 里的「地道表达」：取 corrected 侧中、rawText 里完全没有的
 * 词位组成的最长连续片段（逐词、忽略大小写）。整句重写、纯删词等提取不出
 * 有意义片段时，退回整句 correctedText——整句本身也是地道说法。
 */
export function extractKeyExpression(rawText: string, correctedText: string): string {
  const rawTokens = new Set(tokenize(rawText).map((t) => t.toLowerCase()));
  let best = "";
  let current: string[] = [];
  const flush = () => {
    const candidate = current.join(" ");
    if (candidate.length > best.length) best = candidate;
    current = [];
  };
  for (const token of tokenize(correctedText)) {
    if (rawTokens.has(token.toLowerCase())) flush();
    else current.push(token);
  }
  flush();
  return best || correctedText.trim();
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** 背面：原句 + 中文说明，HTML 行分隔（与阅读模式卡片同款排版）。 */
export function renderSpeechBack(record: SpeechRecord): string {
  const lines: string[] = ["<b>原句</b>", escapeHtml(record.rawText)];
  if (record.note.trim()) {
    lines.push("", "<b>说明</b>", escapeHtml(record.note));
  }
  return lines.join("<br>");
}

/**
 * 一条纠错记录 → Anki 卡片。
 *
 * 正面 = correctedText 里的地道表达，背面 = 原句 + 中文说明，
 * tags = [口语, apothecary]。只调 addNote 一个动作：Anki 未开时
 * addNote 返回 unreachable → 映射为 deferred；其余失败映射为 skipped。
 */
export async function ingestSpeech(
  record: SpeechRecord,
  deps: IngestSpeechDeps,
): Promise<IngestSpeechOutcome> {
  const corrected = record.correctedText.trim();
  if (!corrected) return { kind: "skipped", detail: "no_corrected_text" };

  const created = await addNote(deps.config, {
    deckName: CAPTURE_DECK,
    modelName: CAPTURE_MODEL,
    fields: {
      Front: extractKeyExpression(record.rawText, corrected),
      Back: renderSpeechBack(record),
    },
    tags: [SPEECH_TAG, CAPTURE_TAG],
  });

  if (!created.ok) {
    if (created.reason === "unreachable") return { kind: "deferred", detail: created.detail };
    return { kind: "skipped", detail: `add_failed: ${created.detail}` };
  }
  return { kind: "created", noteId: created.result };
}
