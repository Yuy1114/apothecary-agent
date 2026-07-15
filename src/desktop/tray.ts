import { app, Menu, Tray, nativeImage, type MenuItemConstructorOptions } from "electron";
import { readDaySchedule, instantiateDay, toggleScheduleItem } from "../application/schedule/scheduleStore.js";
import { formatLocalDate, scheduleSummary, type ScheduleItem } from "../domain/schedule.js";
import { logger } from "../observability/logger.js";

export type TrayDeps = {
  vaultPath: string;
  showConsole: () => Promise<void>;
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
const itemLabel = (item: ScheduleItem): string =>
  item.time ? `${item.time}${item.endTime ? `–${item.endTime}` : ""}  ${truncate(item.title)}` : truncate(item.title);

/**
 * The 日程 status-bar entry: menu-bar-first is the product surface, so the
 * menu is rebuilt from the day note on every open — an Obsidian edit shows up
 * the next time the tray is clicked, no cache to invalidate.
 */
export function installScheduleTray(deps: TrayDeps): ScheduleTray {
  // Held in the returned closure: a local Tray gets garbage-collected and the
  // icon silently vanishes (classic Electron pitfall).
  const tray = new Tray(nativeImage.createFromPath(deps.iconPath));
  tray.setToolTip("Apothecary");

  const buildMenuTemplate = async (): Promise<MenuItemConstructorOptions[]> => {
    const today = formatLocalDate();
    const schedule = await readDaySchedule(deps.vaultPath, today);
    const summary = scheduleSummary(schedule.items);
    const timedFirst = [...schedule.items].sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));

    const template: MenuItemConstructorOptions[] = [
      { label: `今日 ${summary.total} 项 · 剩 ${summary.remaining}`, enabled: false },
      { type: "separator" },
    ];
    if (schedule.items.length === 0) {
      template.push({ label: "今日暂无日程", enabled: false });
    } else {
      for (const item of timedFirst) {
        template.push({
          label: itemLabel(item),
          type: "checkbox",
          checked: item.done,
          click: () => {
            void toggleScheduleItem(deps.vaultPath, today, item.line, item.raw)
              .then((fresh) => refreshTitle(scheduleSummary(fresh.items)))
              .catch((error) => logger.warn("schedule", `打卡失败: ${(error as Error).message}`));
          },
        });
      }
    }
    template.push({ type: "separator" });
    if (!schedule.exists) {
      template.push({
        label: "生成今日日程",
        click: () => {
          void instantiateDay(deps.vaultPath, today)
            .catch((error) => logger.warn("schedule", `生成失败: ${(error as Error).message}`));
        },
      });
    }
    template.push(
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
      logger.warn("schedule", `托盘菜单构建失败: ${(error as Error).message}`);
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
