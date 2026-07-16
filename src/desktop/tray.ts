import { app, Menu, Tray, nativeImage, type MenuItemConstructorOptions } from "electron";
import { instantiatePeriod, readPeriod, togglePlanItem } from "../application/journal/journalStore.js";
import { formatLocalDate, planSummary, type PlanItem } from "../domain/journal.js";
import { logger } from "../observability/logger.js";

export type TrayDeps = {
  vaultPath: string;
  showConsole: () => Promise<void>;
  /** Open the console focused on today's journal (deep link into the 日记 view). */
  openJournal: () => void;
  iconPath: string;
};

export type ScheduleTray = {
  refreshTitle: (summary: { total: number; remaining: number }) => void;
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

  const refreshTitle = (summary: { total: number; remaining: number }): void => {
    tray.setTitle(summary.remaining > 0 ? ` ${summary.remaining}` : "");
  };

  return {
    refreshTitle,
    buildMenuTemplate,
    destroy: () => tray.destroy(),
  };
}
