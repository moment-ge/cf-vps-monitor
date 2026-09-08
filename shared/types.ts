export interface Settings {
  siteName: string;
  description: string;
  logoUrl: string;
  public: boolean;
  reportInterval: number;
  retentionDays: number;
  historyInterval: number;
  offlineAfter: number;
  cpuThreshold: number;
  memoryThreshold: number;
  diskThreshold: number;
  expiryDays: number;
  alertsEnabled: boolean;
}
export const defaults: Settings = {
  siteName: "云端观测站",
  description: "基础设施运行状态",
  logoUrl: "",
  public: true,
  reportInterval: 120,
  retentionDays: 7,
  historyInterval: 900,
  offlineAfter: 420,
  cpuThreshold: 90,
  memoryThreshold: 90,
  diskThreshold: 90,
  expiryDays: 7,
  alertsEnabled: true,
};
export function effectiveSettings(
  config: Settings,
  activeNodes: number,
): Settings {
  const reportInterval = Math.max(
    config.reportInterval,
    Math.ceil((activeNodes * 86400) / 35000 / 60) * 60,
  );
  return {
    ...config,
    reportInterval,
    historyInterval: Math.max(
      config.historyInterval,
      reportInterval,
      Math.ceil((activeNodes * 86400 * 4) / 20000 / 60) * 60,
    ),
    offlineAfter: Math.max(config.offlineAfter, reportInterval * 3 + 60),
  };
}
export interface Metrics {
  os: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  cpu: number;
  memoryUsed: number;
  memoryTotal: number;
  diskUsed: number;
  diskTotal: number;
  uploadRate: number;
  downloadRate: number;
  uploadTotal: number;
  downloadTotal: number;
  uptime: number;
  latencyMs: number | null;
  lossPercent: number | null;
}
export interface NodeConfig {
  name: string;
  region: string;
  group: string;
  visible: boolean;
  sortOrder: number;
  price: number;
  currency: string;
  billingCycle: string;
  expiresAt: string | null;
  notes: string;
  latitude: number | null;
  longitude: number | null;
  location: string;
  /** Monthly traffic quota in bytes. 0 means no quota is tracked. */
  trafficLimit: number;
}
export interface RecentSample {
  ts: number;
  latencyMs: number | null;
  lossPercent: number | null;
  uploadRate: number;
  downloadRate: number;
}
export interface MonitorNode extends NodeConfig {
  id: string;
  createdAt: number;
  lastSeen: number;
  online: boolean;
  archived: boolean;
  metrics: Metrics | null;
}
/** The complete allowlist of node information available without authentication. */
export interface PublicNode {
  id: string;
  name: string;
  status: "online" | "warning" | "offline" | "pending";
}
export interface PublicFleet {
  privacy: "status-only";
  nodes: PublicNode[];
  interval: number;
}
export interface HistoryPoint {
  ts: number;
  metrics: Metrics;
}
export interface MonitorEvent {
  id: string;
  node_id: string;
  name: string;
  kind: string;
  message: string;
  created_at: number;
  delivered: number;
}
