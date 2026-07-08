import { createWriteStream, existsSync, promises as fs, renameSync, statSync, type WriteStream } from "node:fs";
import path from "node:path";
import { setLogLevel, type LogLevel } from "../observability/logger.js";

const LOG_FILE = "desktop.log";
const MAX_BYTES = 5 * 1024 * 1024; // rotate once past 5 MB so it never grows unbounded

let fileStream: WriteStream | null = null;

/**
 * Mirror everything the process prints (our structured logger, plain console
 * output, and the Mastra PinoLogger's pretty stream) into a file, so the
 * packaged app is debuggable and slow/stuck runs leave a durable trace. Also
 * raises the log level to `info` (or APOTHECARY_LOG_LEVEL).
 */
export async function initFileLogging(logsDir: string): Promise<string> {
  await fs.mkdir(logsDir, { recursive: true });
  const file = path.join(logsDir, LOG_FILE);
  try {
    if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
  } catch {
    // rotation is best-effort
  }
  fileStream = createWriteStream(file, { flags: "a" });
  fileStream.write(`\n===== session ${new Date().toISOString()} =====\n`);
  teeToFile(process.stdout);
  teeToFile(process.stderr);
  setLogLevel(((process.env.APOTHECARY_LOG_LEVEL as LogLevel) ?? "info"));
  return file;
}

// Wrap a stream's write so each chunk is also appended to the log file. The
// original write still runs, so the terminal is unaffected; file writes are
// best-effort and never throw back into the caller.
function teeToFile(target: NodeJS.WriteStream): void {
  const original = target.write.bind(target);
  target.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
    try {
      fileStream?.write(typeof chunk === "string" ? chunk : (chunk as Uint8Array));
    } catch {
      // ignore file errors; never disrupt stdout/stderr
    }
    return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof target.write;
}
