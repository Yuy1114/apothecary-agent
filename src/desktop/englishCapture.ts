import { logger } from "../observability/logger.js";
import { classifyCapture, type Capture } from "../domain/englishCapture.js";

/**
 * Reading mode: while it is on, anything Yuy copies is treated as a word he did
 * not know and queued for lookup. Nothing pops up and nothing is clicked — the
 * whole point is that looking a word up must not interrupt the reading.
 *
 * This replaces the PopClip extensions, which required a click and (for one of
 * them) typing the meaning into a dialog — still an interruption, and still
 * scoped duplicate detection to a single deck.
 *
 * Electron has no clipboard-change event, so this polls. The privacy contract
 * that makes polling acceptable:
 *   - off by default, only ever on because the tray was clicked
 *   - the clipboard is not read at all while off (guarded before the read)
 *   - the session auto-expires, so a forgotten toggle stops on its own
 *   - captured text is never logged — counts only
 * The credential heuristic in `domain/englishCapture` is the second line, not
 * the first: the switch is.
 */

export const DEFAULT_POLL_MS = 700;
export const DEFAULT_AUTO_OFF_MINUTES = 90;

export type ReadingSession = {
  active: boolean;
  /** ISO timestamp the session started, null when inactive. */
  startedAt: string | null;
  /** What is being read, recorded once per session rather than per word. */
  sourceLabel?: string;
  /** Captures accepted this session (for the tray). */
  captured: number;
};

export type CaptureWatcherDeps = {
  /** Injected so tests need no Electron: in the app this is `clipboard.readText`. */
  readClipboard: () => string;
  /** Queue an accepted capture. Failures are logged and swallowed. */
  onCapture: (capture: {
    kind: Exclude<Capture, { kind: "ignore" }>["kind"];
    text: string;
    lookup: string;
    sourceLabel?: string;
  }) => Promise<void>;
  /** Called whenever the session changes, so the tray can redraw. */
  onSessionChanged?: (session: ReadingSession) => void;
  autoOffMinutes?: number;
  pollMs?: number;
  now?: () => Date;
};

export type CaptureWatcher = {
  /** One poll. Exposed so tests drive it directly instead of waiting on a timer. */
  tick: () => Promise<void>;
  /** Turn reading mode on (idempotent). Returns the session. */
  start: (sourceLabel?: string) => ReadingSession;
  /** Turn reading mode off (idempotent). */
  end: () => ReadingSession;
  /** Flip the switch; returns whether it is now on. */
  toggle: (sourceLabel?: string) => boolean;
  session: () => ReadingSession;
  /** Dispose the poll timer. */
  stop: () => void;
};

export function startCaptureWatcher(deps: CaptureWatcherDeps): CaptureWatcher {
  const now = deps.now ?? (() => new Date());
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  const autoOffMs = (deps.autoOffMinutes ?? DEFAULT_AUTO_OFF_MINUTES) * 60_000;

  let active = false;
  let startedAt: Date | null = null;
  let sourceLabel: string | undefined;
  let captured = 0;
  // Seeded at start with whatever is already on the clipboard, so the last thing
  // copied before reading mode was switched on is never captured.
  let lastSeen = "";
  let timer: NodeJS.Timeout | null = null;

  const snapshot = (): ReadingSession => ({
    active,
    startedAt: startedAt ? startedAt.toISOString() : null,
    sourceLabel,
    captured,
  });

  const announce = (): ReadingSession => {
    const session = snapshot();
    deps.onSessionChanged?.(session);
    return session;
  };

  const tick = async (): Promise<void> => {
    if (!active) return;

    if (startedAt && now().getTime() - startedAt.getTime() >= autoOffMs) {
      logger.info("english", `阅读模式自动关闭（超过 ${deps.autoOffMinutes ?? DEFAULT_AUTO_OFF_MINUTES} 分钟）`);
      end();
      return;
    }

    let raw: string;
    try {
      raw = deps.readClipboard();
    } catch (error) {
      logger.warn("english", `读剪贴板失败: ${(error as Error).message}`);
      return;
    }

    const capture = classifyCapture(raw, lastSeen);
    // Remember what was seen even when it is rejected, so a dropped credential is
    // judged once rather than on every poll.
    lastSeen = raw;
    if (capture.kind === "ignore") return;

    captured += 1;
    // Deliberately no text in the log line.
    logger.info("english", `捕获 ${capture.kind}（本次会话第 ${captured} 个）`);
    try {
      await deps.onCapture({
        kind: capture.kind,
        text: capture.text,
        lookup: capture.lookup,
        sourceLabel,
      });
    } catch (error) {
      logger.warn("english", `捕获入队失败: ${(error as Error).message}`);
    }
    announce();
  };

  const start = (label?: string): ReadingSession => {
    if (!active) {
      active = true;
      startedAt = now();
      captured = 0;
      // Prime the baseline before the first poll.
      try {
        lastSeen = deps.readClipboard();
      } catch {
        lastSeen = "";
      }
      timer = setInterval(() => void tick(), pollMs);
      logger.info("english", `阅读模式开启${label ? `：${label}` : ""}`);
    }
    sourceLabel = label ?? sourceLabel;
    return announce();
  };

  const end = (): ReadingSession => {
    if (active) {
      logger.info("english", `阅读模式关闭（本次捕获 ${captured} 个）`);
    }
    active = false;
    startedAt = null;
    sourceLabel = undefined;
    lastSeen = "";
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    return announce();
  };

  return {
    tick,
    start,
    end,
    toggle: (label?: string) => {
      if (active) {
        end();
        return false;
      }
      start(label);
      return true;
    },
    session: snapshot,
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
