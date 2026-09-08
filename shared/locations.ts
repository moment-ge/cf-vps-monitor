import type { MonitorNode } from "./types";

// Coarse regional reference points only, never inferred datacenter locations.
const centers: Record<string, [number, number]> = {
  CN: [35, 105],
  HK: [22.3, 114.2],
  TW: [23.7, 121],
  JP: [36, 138],
  SG: [1.35, 103.82],
  US: [39.8, -98.6],
  DE: [51, 10],
  FR: [46.6, 2.2],
  GB: [54, -2],
  NL: [52.2, 5.3],
  CA: [56, -106],
  AU: [-25, 134],
  KR: [36, 128],
  IN: [21, 78],
  RU: [61, 100],
};

/** Display names for the regions an administrator can pick. */
export const regionNames: Record<string, string> = {
  CN: "中国大陆",
  HK: "中国香港",
  TW: "中国台湾",
  JP: "日本",
  SG: "新加坡",
  US: "美国",
  DE: "德国",
  FR: "法国",
  GB: "英国",
  NL: "荷兰",
  CA: "加拿大",
  AU: "澳大利亚",
  KR: "韩国",
  IN: "印度",
  RU: "俄罗斯",
};
export function nodeLocation(
  node: Pick<MonitorNode, "latitude" | "longitude" | "region" | "location">,
) {
  if (
    node.latitude != null &&
    node.longitude != null &&
    Number.isFinite(node.latitude) &&
    Number.isFinite(node.longitude)
  ) {
    return {
      latitude: node.latitude,
      longitude: node.longitude,
      approximate: false,
      label: node.location || node.region,
    };
  }
  const point = centers[node.region];
  return point
    ? {
        latitude: point[0],
        longitude: point[1],
        approximate: true,
        label: node.region,
      }
    : null;
}
export function globePosition(latitude: number, longitude: number, radius = 1) {
  const lat = (latitude * Math.PI) / 180;
  const lon = (longitude * Math.PI) / 180;
  return [
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    -radius * Math.cos(lat) * Math.sin(lon),
  ] as const;
}
export function groupLocations(nodes: MonitorNode[]) {
  const groups = new Map<
    string,
    {
      key: string;
      latitude: number;
      longitude: number;
      approximate: boolean;
      label: string;
      nodes: MonitorNode[];
    }
  >();
  for (const node of nodes) {
    if (node.archived) continue;
    const point = nodeLocation(node);
    if (!point) continue;
    const key = `${point.approximate ? node.region : "manual"}:${point.latitude.toFixed(3)}:${point.longitude.toFixed(3)}`;
    const group = groups.get(key);
    if (group) group.nodes.push(node);
    else groups.set(key, { ...point, key, nodes: [node] });
  }
  return [...groups.values()];
}
