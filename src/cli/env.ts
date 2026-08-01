import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/**
 * Credentials for the headless CLI.
 *
 * The desktop app stores its API keys as Electron `safeStorage` ciphertext,
 * which only Electron can decrypt — so the CLI cannot borrow them. It reads the
 * project's own `.env` instead, located from this file rather than from the
 * working directory: `apo` is meant to be called from anywhere (a cron job, a
 * Hermes session), and absorbing whatever `.env` happens to sit in that cwd
 * would be both surprising and a credential-leak shape.
 *
 * Only credential keys are adopted. `APOTHECARY_VAULT_PATH` in particular is
 * ignored here: which vault is current is the desktop app's live decision (see
 * vaultLocator), and a stale line in `.env` must not silently override it.
 */

const CREDENTIAL_KEYS = [
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "OPENAI_API_KEY",
  "APOTHECARY_EMBEDDING_API_KEY",
  "APOTHECARY_EMBEDDING_BASE_URL",
  "APOTHECARY_EMBEDDING_MODEL",
  "APOTHECARY_EMBEDDING_TIMEOUT_MS",
  "APOTHECARY_CHAT_MODEL",
  "APOTHECARY_ANKI_CONNECT_URL",
  "APOTHECARY_ANKI_TIMEOUT_MS",
] as const;

/** `<root>/dist/cli/env.js` and `<root>/src/cli/env.ts` are both two levels deep. */
export function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** Which credential keys a parsed env file would contribute, given what is already set. */
export function selectCredentials(
  parsed: Record<string, string>,
  current: NodeJS.ProcessEnv,
): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const key of CREDENTIAL_KEYS) {
    // A real environment variable always wins: the caller was explicit.
    if (current[key]) continue;
    const value = parsed[key];
    if (value) selected[key] = value;
  }
  return selected;
}

/**
 * Load credentials into `process.env`. Best-effort: commands that do not need a
 * model must keep working on a machine with no `.env` at all.
 */
export async function loadProjectEnv(root: string = projectRoot()): Promise<string[]> {
  const file = path.join(root, ".env");
  const contents = await fs.readFile(file, "utf8").catch(() => null);
  if (contents === null) return [];

  const selected = selectCredentials(dotenv.parse(contents), process.env);
  for (const [key, value] of Object.entries(selected)) process.env[key] = value;
  return Object.keys(selected);
}
