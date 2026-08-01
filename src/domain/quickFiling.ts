import path from "node:path";
import type { InboxEntry } from "./inboxSurvey.js";

/**
 * 快速归位 — deterministic placement for the `_inbox` entries whose destination
 * follows from their type alone, decided before the organizer ever sees them.
 *
 * Two reasons this is a rule and not a judgement call:
 *
 * 1. **Nothing can be learned by looking.** A screenshot's content does not
 *    change the fact that it belongs in `media/screenshots/`. Asking an LLM
 *    where to put fifty screenshots burns fifty decisions to reach one answer
 *    that was knowable from the extension.
 * 2. **Otherwise they never move.** Non-text files cannot be read (see
 *    `readInboxFile`), so the organizer classifies them from the filename and
 *    records a low-confidence `leave` when the name is meaningless — which is
 *    exactly the `IMG_4821.jpeg` case. They pile up forever.
 *
 * Destinations follow the vault README's declared map, not a taxonomy invented
 * here: `media/` is photos/screenshots/attachments, `resources/` is
 * clippings/code/books.
 *
 * **PDFs are deliberately excluded.** They are about to become readable (text
 * extraction), and the vault's own rule — "原件进 records/，思考进 areas/" —
 * needs the content to apply: a bank statement and a downloaded paper are both
 * `.pdf`, and mechanically filing the first into `resources/` would be worse
 * than leaving it. Markdown, text, directories and packages are excluded for the
 * same reason: their placement is a judgement, and judgement is the organizer's.
 */

export type QuickFiling = {
  /** Target skeleton directory, matching `IntakeDecision.dest`. */
  dest: string;
  /** Shown to the human in the plan review, in Chinese like every rationale. */
  rationale: string;
  /** Honest about how much the rule actually knows. */
  confidence: number;
  /**
   * The rule is guessing, and looking at the file would beat guessing. Set only
   * where a vision model could actually help — an unrecognisable image, never a
   * video, which nothing here can watch. Callers with a describer available
   * should leave these to the organizer instead of settling them.
   */
  provisional?: boolean;
};

/** Screenshot tools, across the ones that actually run on this machine. */
const SCREENSHOT_PATTERNS = [
  /^screen\s?shot\b/i, // macOS, both the modern and the pre-Mojave spelling
  /^cleanshot\b/i,
  /^snipaste[_-]/i,
  /^scr-\d{8}/i, // CleanShot X
  /^xnip\d{4}/i,
  /^屏幕快照/, // macOS in Chinese
  /截图/, // 微信/企业微信/QQ and most Chinese tools, anywhere in the name
];

/** Camera and phone naming schemes. */
const CAMERA_PATTERNS = [/^img[_-]?\d/i, /^dsc[_-]?\d/i, /^pxl_\d{8}/i, /^photo[_-]\d/i];

const BOOK_EXTS = new Set([".epub", ".azw3", ".azw", ".mobi", ".fb2"]);

/**
 * Source files. Deliberately excludes `.html`/`.css`: a loose .html is far more
 * often a saved web page (a clipping) than source, and that is a judgement.
 */
const CODE_EXTS = new Set([
  ".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".c", ".cc", ".cpp", ".h", ".hpp",
  ".go", ".rs", ".rb", ".php", ".sh", ".zsh", ".sql", ".swift", ".kt", ".scala",
  ".lua", ".r", ".m", ".vue", ".svelte",
]);

function matches(name: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(name));
}

/**
 * The deterministic destination for one entry, or `null` when placing it needs
 * judgement. Pure.
 */
export function quickFileEntry(entry: InboxEntry): QuickFiling | null {
  const name = entry.name;
  const ext = (entry.ext ?? path.extname(name)).toLowerCase();

  if (BOOK_EXTS.has(ext)) {
    return { dest: "resources/books", rationale: `${ext} 电子书，按类型归入书库`, confidence: 1 };
  }
  if (CODE_EXTS.has(ext)) {
    return { dest: "resources/code", rationale: `${ext} 源码文件，按类型归入代码资料`, confidence: 0.95 };
  }

  if (entry.kind === "image") {
    if (matches(name, SCREENSHOT_PATTERNS)) {
      return { dest: "media/screenshots", rationale: "文件名符合截图工具的命名，归入截图", confidence: 0.95 };
    }
    if (matches(name, CAMERA_PATTERNS)) {
      return { dest: "media/photos", rationale: "文件名符合相机/手机的命名，归入照片", confidence: 0.9 };
    }
    // Honest fallback: we know it is an image and nothing more. Attachments is
    // the vault's catch-all for media that is neither a photo nor a screenshot.
    // Marked provisional — this is exactly the case a vision model settles.
    return {
      dest: "media/attachments",
      rationale: "图片，名称看不出用途，先归入附件",
      confidence: 0.6,
      provisional: true,
    };
  }

  if (entry.kind === "video" || entry.kind === "audio") {
    const label = entry.kind === "video" ? "视频" : "音频";
    return { dest: "media/attachments", rationale: `${label}文件，归入媒体附件`, confidence: 0.75 };
  }

  return null;
}
