import { app, Menu, Tray, nativeImage, type MenuItemConstructorOptions } from "electron";
import { instantiatePeriod, readPeriod, togglePlanItem } from "../application/journal/journalStore.js";
import { formatLocalDate, planSummary, type PlanItem } from "../domain/journal.js";
import { logger } from "../observability/logger.js";
import type { ReadingSession } from "./englishCapture.js";

export type TrayDeps = {
  vaultPath: string;
  showConsole: () => Promise<void>;
  /** Open the console focused on today's journal (deep link into the 日记 view). */
  openJournal: () => void;
  iconPath: string;
  /**
   * English reading mode. The tray is the only surface for it on purpose: the
   * switch must be one click away from anywhere, and its state must be visible
   * in the menu bar at all times — it gates clipboard polling.
   */
  reading?: {
    session: () => ReadingSession;
    toggle: () => boolean;
    /** Settle whatever was captured against Anki (needs Anki running). */
    drain: () => Promise<void>;
  };
};

export type ScheduleTray = {
  refreshTitle: (summary: { total: number; remaining: number }) => void;
  /** Redraw the menu-bar title from current state (e.g. a capture just landed). */
  redraw: () => void;
  /** Exposed for the env-gated e2e hooks: the menu as a plain template. */
  buildMenuTemplate: () => Promise<MenuItemConstructorOptions[]>;
  destroy: () => void;
};

const TITLE_MAX = 40;
const truncate = (text: string): string => (text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text);
const itemLabel = (item: PlanItem): string =>
  item.time ? `${item.time}${item.endTime ? `–${item.endTime}` : ""}  ${truncate(item.title)}` : truncate(item.title);

/**
 * The 日程 status-bar entry: menu-bar-first is the product surface, so the
 * menu is rebuilt from the day's journal note on every open — an Obsidian edit
 * shows up the next time the tray is clicked, no cache to invalidate.
 */
export function installScheduleTray(deps: TrayDeps): ScheduleTray {
  // Held in the returned closure: a local Tray gets garbage-collected and the
  // icon silently vanishes (classic Electron pitfall).
  const tray = new Tray(nativeImage.createFromPath(deps.iconPath));
  tray.setToolTip("Apothecary");

  const buildMenuTemplate = async (): Promise<MenuItemConstructorOptions[]> => {
    const today = formatLocalDate();
    const journal = await readPeriod(deps.vaultPath, "daily", today);
    const summary = planSummary(journal.items);
    const timedFirst = [...journal.items].sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));

    const template: MenuItemConstructorOptions[] = [
      { label: `今日 ${summary.total} 项 · 剩 ${summary.remaining}`, enabled: false },
      { type: "separator" },
    ];
    if (journal.items.length === 0) {
      template.push({ label: "今日暂无计划", enabled: false });
    } else {
      for (const item of timedFirst) {
        template.push({
          label: itemLabel(item),
          type: "checkbox",
          checked: item.done,
          click: () => {
            void togglePlanItem(deps.vaultPath, "daily", today, item.line, item.raw)
              .then((fresh) => refreshTitle(planSummary(fresh.items)))
              .catch((error) => logger.warn("journal", `打卡失败: ${(error as Error).message}`));
          },
        });
      }
    }
    if (deps.reading) {
      const session = deps.reading.session();
      template.push({ type: "separator" });
      template.push({
        label: session.active
          ? `英语阅读模式 · 已捕获 ${session.captured}`
          : "进入英语阅读模式",
        type: "checkbox",
        checked: session.active,
        click: () => {
          const nowActive = deps.reading!.toggle();
          renderTitle();
          // Leaving reading mode is the moment to push everything to Anki.
          if (!nowActive) {
            void deps.reading!.drain().catch((error) =>
              logger.warn("english", `入 Anki 失败: ${(error as Error).message}`),
            );
          }
        },
      });
      if (!session.active) {
        template.push({
          label: "把待处理的生词推入 Anki",
          click: () => {
            void deps.reading!.drain().catch((error) =>
              logger.warn("english", `入 Anki 失败: ${(error as Error).message}`),
            );
          },
        });
      }
    }

    template.push({ type: "separator" });
    if (!journal.exists) {
      template.push({
        label: "生成今日日记",
        click: () => {
          void instantiatePeriod(deps.vaultPath, "daily", today)
            .catch((error) => logger.warn("journal", `生成失败: ${(error as Error).message}`));
        },
      });
    }
    template.push(
      { label: "打开日记", click: () => deps.openJournal() },
      { label: "打开控制台", click: () => void deps.showConsole() },
      { type: "separator" },
      { label: "退出 Apothecary", click: () => app.quit() },
    );
    return template;
  };

  const open = async (): Promise<void> => {
    try {
      tray.popUpContextMenu(Menu.buildFromTemplate(await buildMenuTemplate()));
    } catch (error) {
      logger.warn("journal", `托盘菜单构建失败: ${(error as Error).message}`);
    }
  };
  tray.on("click", () => void open());
  tray.on("right-click", () => void open());

  let lastSummary = { total: 0, remaining: 0 };

  /**
   * Reading mode owns the title while it is on: the menu bar is where Yuy can
   * see that the clipboard is being watched without opening anything.
   */
  const renderTitle = (): void => {
    const reading = deps.reading?.session();
    if (reading?.active) {
      tray.setTitle(` 📖 ${reading.captured}`);
      return;
    }
    tray.setTitle(lastSummary.remaining > 0 ? ` ${lastSummary.remaining}` : "");
  };

  const refreshTitle = (summary: { total: number; remaining: number }): void => {
    lastSummary = summary;
    renderTitle();
  };

  return {
    refreshTitle,
    redraw: renderTitle,
    buildMenuTemplate,
    destroy: () => tray.destroy(),
  };
}
