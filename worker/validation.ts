import {
  defaults,
  type Settings,
  type Metrics,
  type NodeConfig,
} from "../shared/types";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "请求格式无效");
  return value as Record<string, unknown>;
}
function str(v: unknown, label: string, max: number, empty = false): string {
  if (typeof v !== "string" || v.length > max || (!empty && !v.trim()))
    throw new HttpError(400, `${label}格式无效`);
  return v.trim();
}
function num(
  v: unknown,
  label: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v < min ||
    v > max ||
    (integer && !Number.isInteger(v))
  )
    throw new HttpError(400, `${label}范围应为 ${min}–${max}`);
  return v;
}
function bool(v: unknown, label: string): boolean {
  if (typeof v !== "boolean") throw new HttpError(400, `${label}格式无效`);
  return v;
}
export function validateSettings(input: unknown): Settings {
  const d = { ...defaults, ...object(input) };
  const result: Settings = {
    siteName: str(d.siteName, "站点名称", 60),
    description: str(d.description, "站点描述", 160, true),
    logoUrl: str(d.logoUrl, "Logo", 500, true),
    public: bool(d.public, "公开访问"),
    reportInterval: num(d.reportInterval, "上报间隔", 60, 3600, true),
    historyInterval: num(d.historyInterval, "历史间隔", 300, 3600, true),
    retentionDays: num(d.retentionDays, "历史天数", 1, 30, true),
    offlineAfter: num(d.offlineAfter, "离线阈值", 180, 14400, true),
    cpuThreshold: num(d.cpuThreshold, "CPU 阈值", 1, 100),
    memoryThreshold: num(d.memoryThreshold, "内存阈值", 1, 100),
    diskThreshold: num(d.diskThreshold, "磁盘阈值", 1, 100),
    expiryDays: num(d.expiryDays, "到期提醒天数", 1, 90, true),
    alertsEnabled: bool(d.alertsEnabled, "告警开关"),
  };
  if (result.logoUrl && !/^https:\/\//.test(result.logoUrl))
    throw new HttpError(400, "Logo 必须使用 HTTPS 地址");
  if (result.offlineAfter < result.reportInterval * 2)
    throw new HttpError(400, "离线阈值至少为上报间隔的两倍");
  if (result.historyInterval < result.reportInterval)
    throw new HttpError(400, "历史间隔不能小于上报间隔");
  return result;
}
export function validateNode(input: unknown): NodeConfig {
  const d = object(input);
  const expiresAt = d.expiresAt ? str(d.expiresAt, "到期日期", 10) : null;
  if (
    expiresAt &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt) ||
      !Number.isFinite(Date.parse(expiresAt)) ||
      new Date(expiresAt).toISOString().slice(0, 10) !== expiresAt)
  )
    throw new HttpError(400, "到期日期无效");
  const region = str(d.region, "地区", 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(region)) throw new HttpError(400, "地区代码无效");
  const currency = str(d.currency, "币种", 3);
  if (!["CNY", "USD", "EUR", "HKD", "GBP"].includes(currency))
    throw new HttpError(400, "币种无效");
  const billingCycle = str(d.billingCycle, "付费周期", 10);
  if (!["monthly", "quarterly", "yearly", "free"].includes(billingCycle))
    throw new HttpError(400, "付费周期无效");
  const latitude = d.latitude == null ? null : num(d.latitude, "纬度", -90, 90);
  const longitude =
    d.longitude == null ? null : num(d.longitude, "经度", -180, 180);
  if ((latitude === null) !== (longitude === null))
    throw new HttpError(400, "经纬度需要同时填写或同时留空");
  return {
    name: str(d.name, "节点名称", 80),
    region,
    group: str(d.group, "分组", 40),
    visible: bool(d.visible, "可见性"),
    sortOrder: num(d.sortOrder, "排序", -10000, 10000, true),
    price: num(d.price, "价格", 0, 10000000),
    currency,
    billingCycle,
    expiresAt,
    notes: str(d.notes ?? "", "备注", 1000, true),
    latitude,
    longitude,
    location: str(d.location ?? "", "位置名称", 80, true),
    trafficLimit:
      d.trafficLimit == null
        ? 0
        : num(d.trafficLimit, "流量套餐", 0, 1024 ** 5),
  };
}
export function validateMetrics(input: unknown): Metrics {
  const d = object(input);
  const result: Metrics = {
    os: str(d.os, "系统", 100),
    arch: str(d.arch, "架构", 40),
    cpuModel: str(d.cpuModel, "CPU 型号", 200, true),
    cpuCores: num(d.cpuCores, "CPU 核心数", 1, 65536, true),
    cpu: num(d.cpu, "CPU 使用率", 0, 100),
    memoryUsed: num(d.memoryUsed, "内存使用量", 0, 1e16),
    memoryTotal: num(d.memoryTotal, "内存总量", 1, 1e16),
    diskUsed: num(d.diskUsed, "磁盘使用量", 0, 1e18),
    diskTotal: num(d.diskTotal, "磁盘总量", 1, 1e18),
    uploadRate: num(d.uploadRate, "上传速率", 0, 1e15),
    downloadRate: num(d.downloadRate, "下载速率", 0, 1e15),
    uploadTotal: num(d.uploadTotal, "累计上传", 0, 1e18),
    downloadTotal: num(d.downloadTotal, "累计下载", 0, 1e18),
    uptime: num(d.uptime, "运行时间", 0, 1e12),
    latencyMs:
      d.latencyMs === null ? null : num(d.latencyMs, "TCP 延迟", 0, 120000),
    lossPercent:
      d.lossPercent === null ? null : num(d.lossPercent, "TCP 失败率", 0, 100),
  };
  if (
    result.memoryUsed > result.memoryTotal ||
    result.diskUsed > result.diskTotal
  )
    throw new HttpError(400, "使用量不能超过总量");
  return result;
}
