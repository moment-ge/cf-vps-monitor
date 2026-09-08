import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Coins,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  MoreHorizontal,
  Network,
  Star,
} from "lucide-react";
import type { Metrics, MonitorNode, RecentSample } from "../shared/types";
import { regionNames } from "../shared/locations";
import { nodeDetailHref, isLocalNavigation } from "./node-route";
import { api, bytes, daysLeft, percentage } from "./api";

/** Shared with the meter fills: below 60 is healthy, 90 and up needs action. */
export const barLevel = (value: number | null) =>
  value === null ? "idle" : value >= 90 ? "alert" : value >= 60 ? "warn" : "ok";

export type NodeLevel =
  "online" | "warning" | "offline" | "pending" | "archived";

export const trafficUsed = (m: Metrics | null) =>
  m ? m.uploadTotal + m.downloadTotal : 0;

export function trafficPercent(node: MonitorNode) {
  if (!node.trafficLimit) return null;
  return percentage(trafficUsed(node.metrics), node.trafficLimit);
}

/**
 * A node is "warning" while it still reports but something needs attention:
 * a resource above 80%, its quota nearly spent, or an expiry inside the
 * configured window. Anything lower is just "online".
 */
export function nodeLevel(node: MonitorNode, expiryDays: number): NodeLevel {
  if (node.archived) return "archived";
  if (!node.lastSeen) return "pending";
  if (!node.online) return "offline";
  const m = node.metrics;
  const worst = Math.max(
    m?.cpu ?? 0,
    percentage(m?.memoryUsed ?? 0, m?.memoryTotal ?? 0),
    percentage(m?.diskUsed ?? 0, m?.diskTotal ?? 0),
    trafficPercent(node) ?? 0,
  );
  const days = daysLeft(node.expiresAt);
  if (worst >= 80) return "warning";
  if (days !== null && days <= expiryDays) return "warning";
  return "online";
}

export const levelLabel: Record<NodeLevel, string> = {
  online: "在线",
  warning: "警告",
  offline: "离线",
  pending: "待接入",
  archived: "已归档",
};

/* ------------------------------------------------------------------ pieces */

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="spark empty" />;
  const peak = Math.max(...values, 1);
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 26 - (v / peak) * 22;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none">
      <polyline points={points} />
    </svg>
  );
}

function StatCard({
  label,
  icon,
  tone = "neutral",
  value,
  unit,
  meter,
  spark,
  note,
}: {
  label: string;
  icon: ReactNode;
  tone?: string;
  value: string;
  unit?: string;
  meter?: number | null;
  spark?: number[];
  note?: string;
}) {
  const waiting = value === "-";
  return (
    <div className={`stat-card stat-card-${tone}`}>
      <div className="stat-card-head">
        <span className="stat-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value">
        {waiting ? (
          <span className="stat-placeholder">等待采样</span>
        ) : (
          <strong>{value}</strong>
        )}
        {unit && <small>{unit}</small>}
      </div>
      {meter != null && (
        <div className="stat-meter">
          <div className="mbar">
            <i className={barLevel(meter)} style={{ width: `${meter}%` }} />
          </div>
          <span>{meter.toFixed(1)}%</span>
        </div>
      )}
      {spark && <Spark values={spark} />}
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

/** Sums one rate across every node, per shared history timestamp. */
function fleetSeries(
  recent: Record<string, RecentSample[]>,
  key: "uploadRate" | "downloadRate",
  nodeIds: ReadonlySet<string>,
) {
  const totals = new Map<number, number>();
  for (const nodeId of nodeIds) {
    const samples = recent[nodeId] || [];
    for (const s of samples) totals.set(s.ts, (totals.get(s.ts) || 0) + s[key]);
  }
  return [...totals.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-16)
    .map(([, v]) => v);
}

export function StatDeck({
  nodes,
  online,
  recent,
}: {
  nodes: MonitorNode[];
  online: MonitorNode[];
  recent: Record<string, RecentSample[]>;
}) {
  type AggregateMetric =
    | "cpu"
    | "cpuCores"
    | "memoryUsed"
    | "memoryTotal"
    | "diskUsed"
    | "diskTotal"
    | "uploadRate"
    | "downloadRate";
  const reporting = online.filter(
    (node): node is MonitorNode & { metrics: Metrics } =>
      node.online && node.metrics !== null,
  );
  const hasStats = reporting.length > 0;
  const sum = (key: AggregateMetric) =>
    reporting.reduce((acc, node) => acc + node.metrics[key], 0);
  const memUsed = sum("memoryUsed");
  const memTotal = sum("memoryTotal");
  const diskUsed = sum("diskUsed");
  const diskTotal = sum("diskTotal");
  const traffic = reporting.reduce(
    (acc, node) => acc + trafficUsed(node.metrics),
    0,
  );
  const offlineCount = nodes.filter(
    (node) => node.lastSeen && !node.online,
  ).length;
  const pendingCount = nodes.filter((node) => !node.lastSeen).length;
  const [memValue, memUnit] = hasStats ? bytes(memUsed).split(" ") : ["-", ""];
  const [diskValue, diskUnit] = hasStats
    ? bytes(diskUsed).split(" ")
    : ["-", ""];
  const [trafficValue, trafficUnit] = hasStats
    ? bytes(traffic, 2).split(" ")
    : ["-", ""];
  const [upValue, upUnit] = hasStats
    ? bytes(sum("uploadRate")).split(" ")
    : ["-", ""];
  const [downValue, downUnit] = hasStats
    ? bytes(sum("downloadRate")).split(" ")
    : ["-", ""];
  const nodeStatusNote = !nodes.length
    ? "暂无节点"
    : offlineCount
      ? `${offlineCount} 台离线`
      : pendingCount
        ? `${pendingCount} 台待接入`
        : "全部在线";
  const healthTone = offlineCount ? "alert" : pendingCount ? "warn" : "ok";
  return (
    <div className="stat-grid">
      <StatCard
        label="在线节点"
        icon={<Network size={16} strokeWidth={1.8} />}
        tone={healthTone}
        value={String(online.length)}
        unit={nodes.length ? `/ ${nodes.length} 台` : undefined}
        note={nodeStatusNote}
      />
      <StatCard
        label="内存用量"
        icon={<MemoryStick size={16} strokeWidth={1.8} />}
        tone="memory"
        value={memValue}
        unit={memUnit ? `${memUnit} / ${bytes(memTotal)}` : undefined}
        meter={hasStats && memTotal ? percentage(memUsed, memTotal) : null}
        note="在线节点汇总"
      />
      <StatCard
        label="硬盘用量"
        icon={<HardDrive size={16} strokeWidth={1.8} />}
        tone="disk"
        value={diskValue}
        unit={diskUnit ? `${diskUnit} / ${bytes(diskTotal)}` : undefined}
        meter={hasStats && diskTotal ? percentage(diskUsed, diskTotal) : null}
        note="在线节点汇总"
      />
      <StatCard
        label="实时出站"
        icon={<ArrowUp size={16} strokeWidth={1.8} />}
        tone="outbound"
        value={upValue}
        unit={upUnit ? `${upUnit}/s` : undefined}
        note="服务器 → 外网"
        spark={
          hasStats
            ? fleetSeries(
                recent,
                "uploadRate",
                new Set(reporting.map((node) => node.id)),
              )
            : undefined
        }
      />
      <StatCard
        label="累计流量"
        icon={<Gauge size={16} strokeWidth={1.8} />}
        tone="traffic"
        value={trafficValue}
        unit={trafficUnit || undefined}
        note="入站 + 出站（在线节点）"
      />
      <StatCard
        label="实时入站"
        icon={<ArrowDown size={16} strokeWidth={1.8} />}
        tone="inbound"
        value={downValue}
        unit={downUnit ? `${downUnit}/s` : undefined}
        note="外网 → 服务器"
        spark={
          hasStats
            ? fleetSeries(
                recent,
                "downloadRate",
                new Set(reporting.map((node) => node.id)),
              )
            : undefined
        }
      />
    </div>
  );
}

export function GlobeLegend({ counts }: { counts: Record<NodeLevel, number> }) {
  return (
    <ul className="globe-legend">
      {(["online", "warning", "offline", "pending"] as NodeLevel[]).map((k) => (
        <li key={k}>
          <i className={k} />
          <span>{levelLabel[k]}</span>
          <b className="num">{counts[k]}</b>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------- node cards */

function Strip({
  samples,
  kind,
}: {
  samples: RecentSample[];
  kind: "latency" | "loss";
}) {
  const cells: (number | null)[] = Array.from({ length: 16 }, (_, i) => {
    const s = samples[samples.length - 16 + i];
    if (!s) return null;
    return kind === "latency" ? s.latencyMs : s.lossPercent;
  });
  const level = (v: number | null) => {
    if (v === null) return "idle";
    if (kind === "latency")
      return v < 80 ? "ok" : v < 150 ? "fair" : v < 300 ? "warn" : "alert";
    return v === 0 ? "ok" : v < 2 ? "fair" : v < 5 ? "warn" : "alert";
  };
  return (
    <div className="strip">
      {cells.map((v, i) => (
        <i key={i} className={level(v)} />
      ))}
    </div>
  );
}

function MetricCell({
  icon,
  tone,
  label,
  value,
  percent,
  sub,
  muted = false,
}: {
  icon: ReactNode;
  tone: string;
  label: string;
  value: string;
  percent: number | null;
  sub: string;
  muted?: boolean;
}) {
  return (
    <div className="mcell">
      <div className="mtop">
        <span className={`mlabel ${tone}`}>
          {icon}
          {label}
        </span>
        <b className={`num ${barLevel(percent)} ${muted ? "stale" : ""}`}>
          {value}
        </b>
      </div>
      <div className="mbar">
        {percent !== null && (
          <i className={barLevel(percent)} style={{ width: `${percent}%` }} />
        )}
      </div>
      <span className="msub">{sub}</span>
    </div>
  );
}

function TrafficFlow({
  direction,
  label,
  route,
  icon,
  rate,
  total,
}: {
  direction: "outbound" | "inbound";
  label: string;
  route: string;
  icon: ReactNode;
  rate: string;
  total: string;
}) {
  return (
    <div className={`traffic-flow ${direction}`} title={route}>
      <span className="traffic-flow-label">
        {icon}
        {label}
      </span>
      <strong>{rate}</strong>
      <small>累计 {total}</small>
    </div>
  );
}

export function FleetCard({
  node,
  level,
  samples,
  favorite,
  onOpen,
  onFavorite,
  onMenu,
}: {
  node: MonitorNode;
  level: NodeLevel;
  samples: RecentSample[];
  favorite: boolean;
  onOpen: () => void;
  onFavorite: () => void;
  onMenu?: () => void;
}) {
  const m = node.metrics;
  const live = level === "online" || level === "warning";
  const mem = m ? percentage(m.memoryUsed, m.memoryTotal) : null;
  const disk = m ? percentage(m.diskUsed, m.diskTotal) : null;
  const quota = trafficPercent(node);
  const used = trafficUsed(m);
  const days = daysLeft(node.expiresAt);
  const place = [regionNames[node.region] || node.region, node.location]
    .filter(Boolean)
    .join(" · ");
  const latest = samples[samples.length - 1];
  // The node snapshot is the newest accepted report; history is intentionally
  // downsampled, so use it only as a fallback until a live report exists.
  const latency = m?.latencyMs ?? latest?.latencyMs;
  const loss = m?.lossPercent ?? latest?.lossPercent;
  const staleNote = node.lastSeen
    ? "最近一次指标已过期，等待节点恢复上报"
    : "等待节点完成首次上报";
  return (
    <article className={`node-card ${level}`}>
      <a
        className="card-open"
        href={nodeDetailHref(node.id)}
        aria-label={`查看 ${node.name} 详情`}
        onClick={(event) => {
          if (isLocalNavigation(event)) {
            event.preventDefault();
            onOpen();
          }
        }}
      />
      <div className="card-head">
        <i className="state-dot" />
        <h3>{node.name}</h3>
        <span className="state-badge">{levelLabel[level]}</span>
        <button
          type="button"
          className={`card-icon ${favorite ? "on" : ""}`}
          aria-label={favorite ? "取消收藏" : "收藏节点"}
          aria-pressed={favorite}
          onClick={onFavorite}
        >
          <Star size={14} fill={favorite ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          className="card-icon"
          aria-label="更多操作"
          onClick={onMenu}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
      <div className="card-place">
        {regionNames[node.region] ? (
          <img
            className="region-flag"
            src={`/flags/${node.region}.svg`}
            width={20}
            height={14}
            alt={regionNames[node.region]}
            loading="lazy"
          />
        ) : (
          <span className="region-code">{node.region}</span>
        )}
        <span>{place}</span>
      </div>
      {!live && (
        <div className="card-stale-note">
          <i />
          <span>{staleNote}</span>
        </div>
      )}
      <div className="card-metrics">
        <MetricCell
          icon={<Cpu size={13} />}
          tone="t-cpu"
          label="CPU"
          value={m ? `${m.cpu.toFixed(1)}%` : "待采样"}
          percent={live && m ? m.cpu : null}
          sub={m ? `${m.cpuCores} 核 · ${m.arch}` : "等待采集"}
          muted={!live}
        />
        <MetricCell
          icon={<MemoryStick size={13} />}
          tone="t-mem"
          label="内存"
          value={mem !== null ? `${mem.toFixed(1)}%` : "待采样"}
          percent={live ? mem : null}
          sub={
            m ? `${bytes(m.memoryUsed)} / ${bytes(m.memoryTotal)}` : "等待采集"
          }
          muted={!live}
        />
        <MetricCell
          icon={<HardDrive size={13} />}
          tone="t-disk"
          label="硬盘"
          value={disk !== null ? `${disk.toFixed(1)}%` : "待采样"}
          percent={live ? disk : null}
          sub={m ? `${bytes(m.diskUsed)} / ${bytes(m.diskTotal)}` : "等待采集"}
          muted={!live}
        />
        <MetricCell
          icon={<Network size={13} />}
          tone="t-net"
          label="套餐流量"
          value={quota === null ? "不限" : `${quota.toFixed(1)}%`}
          percent={live ? quota : null}
          sub={
            m
              ? `${bytes(used)} 已用 / ${node.trafficLimit ? bytes(node.trafficLimit, 2) : "不限"}`
              : "等待采集"
          }
          muted={!live}
        />
      </div>
      <div className="card-boxes">
        <TrafficFlow
          direction="outbound"
          label="出站"
          route="服务器 → 外网"
          icon={<ArrowUp size={11} />}
          rate={m ? `${bytes(m.uploadRate)}/s` : "待采样"}
          total={m ? bytes(m.uploadTotal) : "—"}
        />
        <TrafficFlow
          direction="inbound"
          label="入站"
          route="外网 → 服务器"
          icon={<ArrowDown size={11} />}
          rate={m ? `${bytes(m.downloadRate)}/s` : "待采样"}
          total={m ? bytes(m.downloadTotal) : "—"}
        />
        <div className="card-billing">
          <span className={days !== null && days <= 14 ? "warn" : ""}>
            <CalendarClock size={11} />
            {days === null ? "长期" : days <= 0 ? "已过期" : `剩余 ${days} 天`}
          </span>
          <span>
            {node.price > 0 ? (
              <>
                <Coins size={11} />
                {node.currency}
                {node.price}
              </>
            ) : (
              node.group
            )}
          </span>
        </div>
      </div>
      <div className="card-net">
        <div>
          <span className="mlabel">
            <Gauge size={12} />
            延迟
          </span>
          <b className={`num ${live ? "" : "stale"}`}>
            {latency != null
              ? `${latency.toFixed(0)} ms`
              : "待采样"}
          </b>
          <Strip samples={samples} kind="latency" />
        </div>
        <div>
          <span className="mlabel">丢包</span>
          <b className={`num ${live ? "" : "stale"}`}>
            {loss != null
              ? `${loss.toFixed(1)}%`
              : "待采样"}
          </b>
          <Strip samples={samples} kind="loss" />
        </div>
      </div>
    </article>
  );
}

/* ---------------------------------------------------------------- visitor */

interface Visitor {
  ip: string;
  country: string;
  city: string;
  isp: string;
  asn: number | null;
}

export function VisitorBar() {
  const [visitor, setVisitor] = useState<Visitor | null>(null);
  useEffect(() => {
    api<Visitor>("/visitor")
      .then(setVisitor)
      .catch(() => setVisitor(null));
  }, []);
  if (!visitor?.ip) return null;
  const place = [visitor.country, visitor.city].filter(Boolean).join(" · ");
  return (
    <div className="visitor-bar">
      <i />
      <span>你的 IP</span>
      <b className="num">{visitor.ip}</b>
      {place && (
        <>
          <em>|</em>
          <span>{place}</span>
        </>
      )}
      {visitor.isp && (
        <>
          <em>|</em>
          <span>
            {visitor.isp}
            {visitor.asn ? ` · AS${visitor.asn}` : ""}
          </span>
        </>
      )}
    </div>
  );
}
