import path from "node:path";
import { app, BrowserWindow, screen, type Rectangle } from "electron";
import type { DropResult } from "../application/intake/dropIntoInbox.js";
import { DropStationChannel } from "./contracts.js";

/**
 * 倾倒站 — a small always-on-top window you drop files onto to get them into
 * `_inbox` without opening Finder and walking to the folder.
 *
 * Two properties are load-bearing and easy to get wrong:
 *
 * - **It must not hide on blur.** The whole interaction is "summon it, then go
 *   click around in Finder and drag back" — clicking Finder blurs this window,
 *   so a blur-hide would make the feature impossible to use.
 * - **It must float above other apps** (and above full-screen ones), because the
 *   file you want is in whatever app you were just reading.
 *
 * It closes on Escape, on its own close button, or by toggling the tray item.
 */

export type DropStation = {
  toggle: (anchor?: Rectangle) => Promise<void>;
  show: (anchor?: Rectangle) => Promise<void>;
  hide: () => void;
  isVisible: () => boolean;
  /** Push an outcome into the window — used when files are dropped on the tray icon. */
  report: (result: DropResult) => void;
  destroy: () => void;
};

const WIDTH = 360;
const HEIGHT = 320;
const MARGIN = 8;

/** Sit under the tray icon when we know where it is, else top-right of the display. */
function placement(anchor?: Rectangle): { x: number; y: number } {
  const display = anchor
    ? screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y })
    : screen.getPrimaryDisplay();
  const { x, y, width } = display.workArea;

  if (!anchor) return { x: Math.round(x + width - WIDTH - MARGIN), y: Math.round(y + MARGIN) };
  // Centre under the icon, clamped so it never hangs off the screen edge.
  const desired = Math.round(anchor.x + anchor.width / 2 - WIDTH / 2);
  return {
    x: Math.min(Math.max(desired, x + MARGIN), x + width - WIDTH - MARGIN),
    y: Math.round(anchor.y + anchor.height + MARGIN),
  };
}

export function createDropStation(deps: { preloadPath: string; pageUrl: string }): DropStation {
  let window: BrowserWindow | null = null;

  const build = async (anchor?: Rectangle): Promise<BrowserWindow> => {
    const { x, y } = placement(anchor);
    const created = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      x,
      y,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // Above full-screen apps too: the file being filed usually lives in whatever
    // was on screen a second ago.
    created.setAlwaysOnTop(true, "floating");
    created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    created.on("closed", () => {
      if (window === created) window = null;
    });
    if (deps.pageUrl.startsWith("http")) await created.loadURL(deps.pageUrl);
    else await created.loadFile(deps.pageUrl);
    return created;
  };

  const show = async (anchor?: Rectangle): Promise<void> => {
    if (!window || window.isDestroyed()) window = await build(anchor);
    else if (anchor) {
      const { x, y } = placement(anchor);
      window.setPosition(x, y);
    }
    window.show();
    window.focus();
  };

  const hide = (): void => {
    if (window && !window.isDestroyed()) window.hide();
  };

  return {
    show,
    hide,
    isVisible: () => Boolean(window && !window.isDestroyed() && window.isVisible()),
    toggle: async (anchor) => {
      if (window && !window.isDestroyed() && window.isVisible()) hide();
      else await show(anchor);
    },
    report: (result) => {
      if (window && !window.isDestroyed()) {
        window.webContents.send(DropStationChannel.result, result);
      }
    },
    destroy: () => {
      if (window && !window.isDestroyed()) window.destroy();
      window = null;
    },
  };
}

/** Where the drop-station page lives, dev server or packaged build. */
export function dropStationPage(rendererDevUrl?: string): string {
  if (rendererDevUrl) return new URL("drop.html", rendererDevUrl).toString();
  return path.join(app.getAppPath(), "dist", "desktop", "ui", "drop.html");
}
