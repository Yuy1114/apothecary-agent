---
name: verify
description: Build, launch, and drive the Apothecary Electron desktop app against an isolated environment to verify desktop changes end-to-end (screenshots + DOM assertions).
---

# Verify desktop changes (Electron GUI)

## Build & launch

```bash
pnpm run build          # tsc + vite renderer → dist/
```

Drive the real app with playwright-core (no repo dependency needed — install it
in a scratch dir: `npm i playwright-core`, then launch Electron directly):

```js
import { _electron } from "playwright-core";
const app = await _electron.launch({
  // playwright can't resolve electron from outside the repo; point at the binary:
  // node -e "console.log(require('<repo>/node_modules/electron'))"
  executablePath: "<repo>/node_modules/.pnpm/electron@<ver>/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
  args: ["."],
  cwd: "<repo>",
  env: { ...process.env, HOME, APOTHECARY_HOME, APOTHECARY_VAULT_PATH, APOTHECARY_USER_DATA_DIR },
});
const win = await app.firstWindow();
```

## Isolation — never run against the real vault

Launching with the user's env would (a) touch the real vault/ledgers and
(b) **persist the vault path into the real desktop-settings.json** (main.ts
merge-persists on startup). Always override all four:

- `APOTHECARY_USER_DATA_DIR` → fake dir. **Required — overriding `HOME` does NOT
  isolate userData**: on macOS Electron resolves Application Support natively,
  so a HOME-only override silently rewrites the real desktop-settings.json
  (this happened once; main.ts honors this env var precisely for isolation).
- `HOME` → fake dir (keeps other dotfile lookups out of the real home)
- `APOTHECARY_HOME` → fake dir (isolates ledgers/index/memory/logs)
- `APOTHECARY_VAULT_PATH` → temp vault (skips the vault-picker dialog)

After any driven run, sanity-check the real
`~/Library/Application Support/apothecary-agent/desktop-settings.json`
still points at the real vault.

Ledger layout inside APOTHECARY_HOME (see `src/config/apothecaryDb.ts` — NOT `sql/`):
`queue/change-log.db`, `operations.db` (root), `index/vectors.db`, `memory/desktop.db`.
Seed them with raw SQL via the repo's `@libsql/client`; schemas are in
`src/vault/changeLog.ts` / `src/vault/operationLedger.ts`.

## Driving gotchas

- Nav labels: `.nav-item:has-text('Vault')` — the sidebar label is "Vault",
  not the topbar title "Vault 文件库". Workspace is "工作区" (not 工作台),
  the runs view is "审阅".
- Proposal cards are `.prop-card`; approve button text is 采纳提案 (approve
  fires a `window.confirm` — auto-accept via `win.on("dialog", d => d.accept())`).
- Toasts share one `.toast.show` element and linger ~2.4s — wait for the old
  one to detach before asserting the next, or match on text via waitForFunction.
- Vault sidebar pseudo-folders are `.tree-row` (最近 / _inbox / 变更), files are `.file-row`.
- Folder file rows display the note H1 **title**, not the filename — select by title.
- App boots fine without LLM/embedding keys; chat and diagnostics just show red.
- Main-process log: `$APOTHECARY_HOME/logs/desktop.log`.
- If a script throws before `app.close()`, check for orphaned Electron processes.

## Flows worth driving

- Vault → 最近: day-grouped merged ledger feed; click a row → preview; deleted rows inert.
- Vault → 变更 / _inbox / a folder: scope switching must not leak state.
- Workspace chat and proposal cards need real keys — leave to live acceptance.
