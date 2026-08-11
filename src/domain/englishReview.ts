import matter from "gray-matter";

/**
 * 复盘笔记 frontmatter 契约与校验。
 *
 * Hermes cron 每晚写入 `notes/英语/` 的复盘笔记，frontmatter 遵循固定 schema，
 * 才能按「日期 / 错误类型」结构化检索。本模块只定义契约 + 校验（纯函数、无 IO），
 * 生成在 Hermes 侧（cron），另行对齐。
 *
 * 合法示例：
 *   ---
 *   type: english-review
 *   date: 2026-08-11
 *   sentences: 3
 *   topics: [tense, preposition]
 *   ---
 *
 * 校验失败时返回具体原因（英文稳定 code，便于 cron 侧机器判断），不抛异常。
 */

export const ENGLISH_REVIEW_TYPE = "english-review";

export type EnglishReviewFrontmatter = {
  type: typeof ENGLISH_REVIEW_TYPE;
  /** 复盘日期，YYYY-MM-DD。 */
  date: string;
  /** 当日纠错句数。 */
  sentences: number;
  /** 纠错类别：tense / word-choice / preposition / pronunciation / … */
  topics: string[];
};

export type EnglishReviewParseResult =
  | { ok: true; data: EnglishReviewFrontmatter }
  | { ok: false; reason: string };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 把 frontmatter 里的 date 归一化为 YYYY-MM-DD 字符串。js-yaml 会把未加引号的
 * `2026-08-11` 解析成 UTC Date，所以两种形态都接受，统一转成字符串返回。
 * 注意：未加引号且不存在的日期（如 2026-02-31）会被 js-yaml 先归一化成
 * 合法 Date（2026-03-03），Date 分支无法还原原始串，只能照单全收；
 * 严格的不存在日期校验只对字符串形态（引号包裹）生效。
 * 值不合法（或不存在）返回 null；「缺 key」与「值不合法」由调用处区分。
 */
function normalizeDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const mo = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  if (typeof value !== "string") return null;
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m;
  const parsed = new Date(Number(y), Number(mo) - 1, Number(d));
  // 拒绝并不存在的日期（如 2026-02-31）。
  if (
    parsed.getFullYear() !== Number(y) ||
    parsed.getMonth() !== Number(mo) - 1 ||
    parsed.getDate() !== Number(d)
  ) {
    return null;
  }
  return value;
}

/**
 * 解析并校验复盘笔记 frontmatter。不抛异常；不合法时返回具体原因。
 * 校验顺序：type → date → sentences → topics，保证「缺某 key」与「值不合法」
 * 各自返回独立的原因。
 */
export function parseEnglishReviewFrontmatter(md: string): EnglishReviewParseResult {
  const data = matter(md).data;

  if (data.type !== ENGLISH_REVIEW_TYPE) {
    return { ok: false, reason: data.type === undefined ? "missing_type" : "invalid_type" };
  }

  if (data.date === undefined) return { ok: false, reason: "missing_date" };
  const date = normalizeDate(data.date);
  if (date === null) return { ok: false, reason: "invalid_date" };

  if (data.sentences === undefined) return { ok: false, reason: "missing_sentences" };
  if (
    typeof data.sentences !== "number" ||
    !Number.isInteger(data.sentences) ||
    data.sentences < 0
  ) {
    return { ok: false, reason: "invalid_sentences" };
  }

  if (data.topics === undefined) return { ok: false, reason: "missing_topics" };
  if (!Array.isArray(data.topics) || data.topics.some((t) => typeof t !== "string")) {
    return { ok: false, reason: "invalid_topics" };
  }

  return {
    ok: true,
    data: {
      type: ENGLISH_REVIEW_TYPE,
      date,
      sentences: data.sentences as number,
      topics: data.topics as string[],
    },
  };
}
