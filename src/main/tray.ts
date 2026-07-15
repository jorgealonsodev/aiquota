// System tray (tray-status spec). Builds the tray icon, tooltip, and context
// menu. Shell code; covered by manual QA.
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from "electron";
import path from "node:path";
import type { TrayColor, TrayState } from "../core/aggregate";

export interface TrayDependencies {
  getTrayState: () => TrayState;
  onOpen: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onQuit: () => void;
}

export interface TrayController {
  tray: Tray;
  update(state: TrayState): void;
  destroy(): void;
}

function trayIconPath(color: TrayColor): string {
  return path.join(__dirname, "../../assets", `tray-${color}.svg`);
}

function loadIcon(color: TrayColor): NativeImage {
  try {
    return nativeImage.createFromPath(trayIconPath(color));
  } catch {
    // Fallback to a blank 16x16 image if the asset is missing.
    return nativeImage.createEmpty();
  }
}

function buildContextMenu(deps: TrayDependencies): Menu {
  const template: MenuItemConstructorOptions[] = [
    { label: "Open", click: deps.onOpen },
    { label: "Refresh", click: deps.onRefresh },
    { type: "separator" },
    { label: "Settings", click: deps.onOpenSettings },
    { type: "separator" },
    { label: "Quit", click: deps.onQuit },
  ];
  return Menu.buildFromTemplate(template);
}

/**
 * Creates the system tray icon and context menu. The initial icon is gray
 * until the first poll result arrives and `update()` is called.
 */
export function createTray(deps: TrayDependencies): TrayController {
  const icon = loadIcon("gray");
  const tray = new Tray(icon);
  tray.setToolTip("AIQuota");
  tray.setContextMenu(buildContextMenu(deps));

  tray.on("click", deps.onOpen);

  return {
    tray,
    update: (state: TrayState) => {
      tray.setImage(loadIcon(state.color));
      tray.setToolTip(state.tooltip || "AIQuota");
    },
    destroy: () => tray.destroy(),
  };
}
