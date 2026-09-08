import type { MonitorNode } from "../shared/types";
import { groupLocations, regionNames } from "../shared/locations";
import type { NodeLevel } from "./Overview";

export type MapStatus = Exclude<NodeLevel, "archived">;
export type LocationGroup = ReturnType<typeof groupLocations>[number];
export type NodeLevels = ReadonlyMap<string, NodeLevel>;
export const mapStatusLabels: Record<MapStatus, string> = {
  online: "运行正常",
  warning: "在线警告",
  offline: "离线异常",
  pending: "待接入",
};

export function mapNodeStatus(
  node: MonitorNode,
  levels: NodeLevels,
): MapStatus {
  const level = levels.get(node.id);
  return level && level !== "archived"
    ? level
    : !node.lastSeen
      ? "pending"
      : node.online
        ? "online"
        : "offline";
}

export function locationStatus(
  location: LocationGroup,
  levels: NodeLevels,
): MapStatus {
  const states = location.nodes.map((node) => mapNodeStatus(node, levels));
  if (states.includes("offline")) return "offline";
  if (states.includes("warning")) return "warning";
  return states.includes("online") ? "online" : "pending";
}

export function locationName(location: LocationGroup) {
  return regionNames[location.label] || location.label || "自定义位置";
}

// These are geographic status illustrations, not measured network links.
export function mapConnections(
  locations: LocationGroup[],
  selectedKey: string,
  levels: NodeLevels,
) {
  const origin =
    locations.find((location) => location.key === selectedKey) ||
    locations.find((location) => location.nodes.some((node) => node.online)) ||
    locations[0];
  if (!origin) return [];
  const rank: Record<MapStatus, number> = {
    offline: 0,
    warning: 1,
    online: 2,
    pending: 3,
  };
  return locations
    .filter((location) => location.key !== origin.key)
    .sort(
      (a, b) =>
        rank[locationStatus(a, levels)] - rank[locationStatus(b, levels)],
    )
    .slice(0, 8)
    .map((destination) => {
      const start = locationStatus(origin, levels);
      const end = locationStatus(destination, levels);
      const status: MapStatus =
        start === "pending" || end === "pending"
          ? "pending"
          : rank[start] < rank[end]
            ? start
            : end;
      return { origin, destination, status };
    });
}
