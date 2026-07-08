/**
 * Lightweight structured logger shared across the app (agent tools, sync, the
 * desktop run pump). It only writes formatted lines to stdout/stderr; the
 * desktop process tees those streams to a file (see src/desktop/logging.ts), so
 * one code path lands in both the terminal and ~/.apothecary/logs/desktop.log.
 *
 * Level defaults to "warn" so tests and library usage stay quiet; the desktop
 * raises it to "info" (or APOTHECARY_LOG_LEVEL) when it starts.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function envThreshold(): number {
  const env = process.env.APOTHECARY_LOG_LEVEL as LogLevel | undefined;
  return env && env in ORDER ? ORDER[env] : ORDER.warn;
}
let threshold = envThreshold();

export function setLogLevel(level: LogLevel): void {
  if (level in ORDER) threshold = ORDER[level];
}

function format(level: LogLevel, scope: string, message: string, data?: unknown): string {
  const head = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  if (data === undefined) return head;
  try {
    return `${head} ${typeof data === "string" ? data : JSON.stringify(data)}`;
  } catch {
    return head; // never let a circular/BigInt payload break logging
  }
}

function emit(level: LogLevel, scope: string, message: string, data?: unknown): void {
  if (ORDER[level] < threshold) return;
  const line = `${format(level, scope, message, data)}\n`;
  (level === "warn" || level === "error" ? process.stderr : process.stdout).write(line);
}

export const logger = {
  debug: (scope: string, message: string, data?: unknown) => emit("debug", scope, message, data),
  info: (scope: string, message: string, data?: unknown) => emit("info", scope, message, data),
  warn: (scope: string, message: string, data?: unknown) => emit("warn", scope, message, data),
  error: (scope: string, message: string, data?: unknown) => emit("error", scope, message, data),
};

/**
 * Start a timer; call the returned function to log the elapsed time (at `info`)
 * with an optional data payload. Used to surface where a slow/stuck run spends
 * its time (e.g. per tool, per reindex).
 */
export function startTimer(scope: string, label: string): (data?: unknown) => number {
  const started = Date.now();
  return (data?: unknown) => {
    const ms = Date.now() - started;
    emit("info", scope, `${label} +${ms}ms`, data);
    return ms;
  };
}
