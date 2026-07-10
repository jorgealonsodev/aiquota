// Pure tray-status aggregation (design.md "aggregate() Tray Contract").
// Zero Electron imports: takes a list of per-instance snapshots and derives
// the tray icon color + tooltip. The Electron shell (Phase 4) is responsible
// for building InstanceSnapshot[] from the StateStore and painting the icon.
import type { QuotaWindow } from "../shared/domain";

/**
 * Status of a single provider instance as seen by the tray, folding together
 * QuotaProvider.authStatus() ("healthy" | "auth-expired" | "unconfigured")
 * and TypedError.kind ("network" | "provider-broken") into one field so
 * aggregate() has a single source of truth for "is this instance usable".
 */
export type InstanceStatus = "healthy" | "auth-expired" | "network" | "provider-broken" | "unconfigured";

export interface InstanceSnapshot {
  instanceId: string;
  label: string;
  enabled: boolean;
  status: InstanceStatus;
  /** Only meaningful when status is "healthy"; empty otherwise. */
  windows: QuotaWindow[];
}

export type TrayColor = "green" | "amber" | "red" | "gray";

export interface TrayState {
  color: TrayColor;
  tooltip: string;
}

/** Amber lower bound (inclusive) and red lower bound (exclusive), per tray-status spec. */
const AMBER_MIN_UTILIZATION = 70;
const RED_MIN_UTILIZATION = 90;

function isTooltipVisible(snapshot: InstanceSnapshot): boolean {
  return snapshot.enabled && snapshot.status !== "unconfigured";
}

function isHealthy(snapshot: InstanceSnapshot): boolean {
  return snapshot.status === "healthy";
}

function highestUtilization(windows: QuotaWindow[]): number {
  return windows.reduce((max, current) => Math.max(max, current.utilization), 0);
}

function colorForUtilization(utilization: number): Exclude<TrayColor, "gray"> {
  if (utilization > RED_MIN_UTILIZATION) return "red";
  if (utilization >= AMBER_MIN_UTILIZATION) return "amber";
  return "green";
}

function tooltipSegment(snapshot: InstanceSnapshot): string {
  if (!isHealthy(snapshot)) {
    return `${snapshot.label} error`;
  }
  return `${snapshot.label} ${highestUtilization(snapshot.windows)}%`;
}

export function aggregate(snapshots: InstanceSnapshot[]): TrayState {
  const visible = snapshots.filter(isTooltipVisible);
  const healthy = visible.filter(isHealthy);

  const tooltip = visible.map(tooltipSegment).join(" · ");

  if (healthy.length === 0) {
    return { color: "gray", tooltip };
  }

  const maxUtilization = Math.max(...healthy.map((snapshot) => highestUtilization(snapshot.windows)));
  return { color: colorForUtilization(maxUtilization), tooltip };
}
