import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Archive,
  Bell,
  Check,
  CheckCircle2,
  Clock3,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  List,
  LoaderCircle,
  LogIn,
  LogOut,
  MemoryStick,
  MapPin,
  Menu,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sun,
  Wallet,
  X,
} from "lucide-react";
import {
  defaults,
  effectiveSettings,
  type HistoryPoint,
  type MonitorEvent,
  type MonitorNode,
  type PublicNode,
  type PublicFleet,
  type NodeConfig,
  type RecentSample,
  type Settings,
} from "../shared/types";
import {
  api,
  ApiError,
  bytes,
  dateTime,
  daysLeft,
  download,
  percentage,
  uptime,
} from "./api";
import { nodeIsOnline, probeEndpoint, sampleAge } from "../shared/node-state";
import {
  FleetCard,
  StatDeck,
  VisitorBar,
  levelLabel,
  nodeLevel,
  type NodeLevel,
} from "./Overview";
import { nodeLocation } from "../shared/locations";
import { useNodeRoute, nodeDetailHref, isLocalNavigation } from "./node-route";
import "./node-detail.css";
import PublicStatus from "./PublicStatus";
import { Button, Checkbox, Input, Select, Textarea } from "./components/ui";

const Chart = lazy(() => import("./Chart"));
const Globe = lazy(() => import("./Globe"));
const regions: Record<string, string> = {
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
const cycles: Record<string, string> = {
  monthly: "月付",
  quarterly: "季付",
  yearly: "年付",
  free: "免费",
};
const blankNode: NodeConfig = {
  name: "",
  region: "US",
  group: "默认分组",
  visible: true,
  sortOrder: 0,
  price: 0,
  currency: "CNY",
  billingCycle: "monthly",
  expiresAt: null,
  notes: "",
  latitude: null,
  longitude: null,
  location: "",
  trafficLimit: 0,
};
type View = "overview" | "nodes" | "billing" | "events" | "settings";
const nav = [
  { id: "overview", title: "运行概览", icon: LayoutDashboard },
  { id: "nodes", title: "节点管理", icon: Server },
  { id: "billing", title: "费用与到期", icon: Wallet },
  { id: "events", title: "告警记录", icon: Bell },
  { id: "settings", title: "站点设置", icon: Settings2 },
] as const;

function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  active = false,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`icon-button ${active ? "active" : ""} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Empty({
  title,
  subtitle,
  action,
  icon,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon || <Server size={34} strokeWidth={1.3} />}
      <h3>{title}</h3>
      {subtitle && <p>{subtitle}</p>}
      {action}
    </div>
  );
}
function Status({ node, level }: { node: MonitorNode; level?: NodeLevel }) {
  const state =
    level ||
    (node.archived
      ? "archived"
      : node.online
        ? "online"
        : node.lastSeen
          ? "offline"
          : "pending");
  return (
    <span className={`status ${state}`}>
      <i />
      {
        {
          online: "在线",
          warning: "警告",
          offline: "离线",
          pending: "待接入",
          archived: "已归档",
        }[state]
      }
    </span>
  );
}
function Meter({
  value,
  color = "green",
}: {
  value: number | null;
  color?: string;
}) {
  return (
    <div className="meter-wrap">
      <span>
        {value === null ? "-" : value.toFixed(1)}
        {value !== null && <small>%</small>}
      </span>
      <div className="meter">
        {value !== null && (
          <i
            className={value >= 90 ? "red" : color}
            style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
          />
        )}
      </div>
    </div>
  );
}
function Flag({ code }: { code: string }) {
  return regions[code] ? (
    <img
      className="region-flag"
      src={`/flags/${code}.svg`}
      width={20}
      height={14}
      alt={regions[code]}
      loading="lazy"
    />
  ) : (
    <span className="region-code" title={code}>
      {code}
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "wide" : ""}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <IconButton label="关闭" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
function Field({
  label,
  children,
  full = false,
}: {
  label: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`field ${full ? "full" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function NodeForm({
  node,
  onClose,
  onSave,
}: {
  node: MonitorNode | null;
  onClose: () => void;
  onSave: (data: NodeConfig, id?: string) => Promise<void>;
}) {
  const [form, setForm] = useState<NodeConfig>(node || blankNode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof NodeConfig>(key: K, value: NodeConfig[K]) =>
    setForm((s) => ({ ...s, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form, node?.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={node ? "编辑节点" : "添加节点"} onClose={onClose}>
      <form onSubmit={submit} className="node-form">
        {!node && (
          <div className="creation-status">
            <Server size={18} />
            <span>
              新节点 <b>待接入</b>
            </span>
            <span>首报后获取系统配置</span>
          </div>
        )}
        <div className="form-grid">
          <Field label="节点名称" full>
            <Input
              autoFocus
              required
              maxLength={80}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="例如 香港 · 生产环境 01"
            />
          </Field>
          <Field label="地区">
            <Select
              value={form.region}
              onChange={(e) => set("region", e.target.value)}
            >
              {Object.entries(regions).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="分组">
            <Input
              required
              maxLength={40}
              value={form.group}
              onChange={(e) => set("group", e.target.value)}
            />
          </Field>
          <label className="check full">
            <Checkbox
              checked={form.visible}
              onCheckedChange={(checked) => set("visible", checked === true)}
            />
            在公开页面展示匿名状态
          </label>
        </div>
        <details className="node-options">
          <summary>
            地图位置{" "}
            <span>{form.latitude == null ? "地区参考点" : "指定坐标"}</span>
          </summary>
          <div className="form-grid">
            <Field label="位置名称" full>
              <Input
                maxLength={80}
                value={form.location}
                placeholder="例如 香港 · 机房 A"
                onChange={(e) => set("location", e.target.value)}
              />
            </Field>
            <Field label="纬度">
              <Input
                type="number"
                min={-90}
                max={90}
                step="any"
                value={form.latitude ?? ""}
                placeholder="-90 至 90"
                onChange={(e) =>
                  set(
                    "latitude",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </Field>
            <Field label="经度">
              <Input
                type="number"
                min={-180}
                max={180}
                step="any"
                value={form.longitude ?? ""}
                placeholder="-180 至 180"
                onChange={(e) =>
                  set(
                    "longitude",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </Field>
            <p className="location-notice full">
              留空使用地区近似位置。位置与坐标仅管理员可见。
            </p>
          </div>
        </details>
        <details className="node-options" open={node ? true : undefined}>
          <summary>
            费用与更多信息 <span>选填</span>
          </summary>
          <div className="form-grid">
            <Field label="续费金额">
              <Input
                type="number"
                min="0"
                max="10000000"
                step="0.01"
                value={form.price}
                onChange={(e) => set("price", Number(e.target.value))}
              />
            </Field>
            <Field label="币种">
              <Select
                value={form.currency}
                onChange={(e) => set("currency", e.target.value)}
              >
                {["CNY", "USD", "EUR", "HKD", "GBP"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </Field>
            <Field label="计费周期">
              <Select
                value={form.billingCycle}
                onChange={(e) => set("billingCycle", e.target.value)}
              >
                {Object.entries(cycles).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="到期日期">
              <Input
                type="date"
                value={form.expiresAt || ""}
                onChange={(e) => set("expiresAt", e.target.value || null)}
              />
            </Field>
            <Field label="流量套餐 (GB)">
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="留空表示不限"
                value={form.trafficLimit ? form.trafficLimit / 1024 ** 3 : ""}
                onChange={(e) =>
                  set(
                    "trafficLimit",
                    e.target.value ? Number(e.target.value) * 1024 ** 3 : 0,
                  )
                }
              />
            </Field>
            <Field label="排序权重">
              <Input
                type="number"
                min="-10000"
                max="10000"
                value={form.sortOrder}
                onChange={(e) => set("sortOrder", Number(e.target.value))}
              />
            </Field>
            <Field label="管理员备注" full>
              <Textarea
                maxLength={1000}
                rows={3}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </Field>
          </div>
        </details>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={saving}>
            <Check size={16} />
            {saving ? "保存中" : node ? "保存修改" : "创建并接入"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TokenModal({
  value,
  interval,
  onConnected,
  onClose,
}: {
  value: { token: string; name: string; id: string; lastSeen: number };
  interval: number;
  onConnected: (node: MonitorNode) => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [platform, setPlatform] = useState("linux-amd64");
  const [networkInterface, setNetworkInterface] = useState("");
  const [diskPath, setDiskPath] = useState("");
  const [connected, setConnected] = useState<MonitorNode | null>(null);
  const [checking, setChecking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [checked, setChecked] = useState(false);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;
  const inflight = useRef(false);
  const check = useCallback(
    async (signal?: AbortSignal) => {
      if (inflight.current) return false;
      inflight.current = true;
      setChecking(true);
      try {
        const result = await api<{ node: MonitorNode }>(
          `/admin/nodes/${value.id}/status`,
          "GET",
          undefined,
          signal,
        );
        if (signal?.aborted) return false;
        setChecked(true);
        setError("");
        if (result.node.lastSeen > value.lastSeen && result.node.online) {
          setConnected(result.node);
          onConnectedRef.current(result.node);
          return true;
        }
      } catch (e) {
        if (!signal?.aborted) setError((e as Error).message);
      } finally {
        inflight.current = false;
        if (!signal?.aborted) setChecking(false);
      }
      return false;
    },
    [value.id, value.lastSeen],
  );
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = performance.now() + 600000;
    const poll = async () => {
      if (controller.signal.aborted) return;
      if (performance.now() >= deadline) {
        setPaused(true);
        return;
      }
      if (!document.hidden && (await check(controller.signal))) return;
      if (!controller.signal.aborted) timer = setTimeout(poll, 10000);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [check]);
  const origin = probeEndpoint(window.location.origin);
  const windows = platform.startsWith("windows");
  const binary = `cf-monitor-agent-${platform}${windows ? ".exe" : ""}`;
  const command = `${windows ? ".\\" : "./"}${binary} -config config.json -once`;
  const config = {
    endpoint: origin,
    token: value.token,
    interval: Math.min(3600, interval),
    diskPath,
    networkInterface,
    tcpProbe: "",
    probeEvery: 5,
  };
  return (
    <Modal title={`${value.name} · 探针接入`} onClose={onClose}>
      <div className="token-body">
        <div
          className={`connection-state ${connected ? "connected" : ""}`}
          role="status"
        >
          {connected ? <CheckCircle2 size={24} /> : <Activity size={24} />}
          <div>
            <strong>{connected ? "已收到真实上报" : "等待探针接入"}</strong>
            <span>
              {connected
                ? `${connected.metrics?.os} · ${connected.metrics?.cpuCores} 核 · ${bytes(connected.metrics?.memoryTotal || 0)}`
                : paused
                  ? "自动检测已暂停"
                  : checked
                    ? "尚未收到新的有效样本"
                    : "正在检查接入状态"}
            </span>
          </div>
          <IconButton
            label="检查接入状态"
            disabled={checking || Boolean(connected)}
            onClick={() => void check()}
          >
            <RefreshCw className={checking ? "spin" : ""} />
          </IconButton>
        </div>
        <div className="form-grid">
          <Field label="监控站点地址" full>
            <Input
              type="url"
              readOnly
              value={window.location.origin}
              aria-invalid={!origin}
            />
          </Field>
          {!origin && (
            <p className="endpoint-error full">
              当前地址无法用于 VPS
              接入。本地密钥仅属于演示数据库，请在正式部署的 HTTPS
              站点重新创建节点。
            </p>
          )}
          <Field label="系统与架构" full>
            <Select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              {[
                ["linux-amd64", "Linux · x86_64"],
                ["linux-arm64", "Linux · ARM64"],
                ["linux-386", "Linux · x86 32 位"],
                ["linux-arm", "Linux · ARMv7"],
                ["windows-amd64", "Windows · x64"],
                ["windows-arm64", "Windows · ARM64"],
                ["darwin-arm64", "macOS · Apple Silicon"],
                ["darwin-amd64", "macOS · Intel"],
              ].map(([id, label]) => (
                <option value={id} key={id}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="出口网卡（选填）">
            <Input
              placeholder="自动汇总"
              value={networkInterface}
              onChange={(e) => setNetworkInterface(e.target.value)}
            />
          </Field>
          <Field label="磁盘路径（选填）">
            <Input
              placeholder="系统盘"
              value={diskPath}
              onChange={(e) => setDiskPath(e.target.value)}
            />
          </Field>
        </div>
        <div className="key-heading">
          <KeyRound size={15} />
          <span>节点密钥 · 仅显示一次</span>
        </div>
        <Field label="节点密钥">
          <Input
            readOnly
            value={value.token}
            onFocus={(e) => e.currentTarget.select()}
          />
        </Field>
        <div className="button-row">
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value.token);
                setCopied(true);
              } catch {
                setError("复制失败，请选中密钥后手动复制");
              }
            }}
          >
            {copied ? <Check size={16} /> : <Clipboard size={16} />}
            {copied ? "已复制" : "复制密钥"}
          </button>
          <button
            className="primary"
            disabled={!origin}
            onClick={() => download("config.json", config)}
          >
            <Download size={16} />
            下载探针配置
          </button>
        </div>
        <h3>单次上报检查</h3>
        <div className="command command-copy">
          <code>{command}</code>
          <IconButton
            label="复制检查命令"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(command);
              } catch {
                setError("复制失败，请手动选择命令");
              }
            }}
          >
            <Clipboard />
          </IconButton>
        </div>
        <p className="muted small">二进制：{binary}</p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
      <div className="modal-actions">
        <button className="primary" onClick={onClose}>
          {connected ? "完成接入" : "稍后接入"}
        </button>
      </div>
    </Modal>
  );
}

function Detail({
  node,
  level,
  dark,
  now,
  admin,
  onEdit,
  onClose,
}: {
  node: MonitorNode;
  level: NodeLevel;
  dark: boolean;
  now: number;
  admin: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [node.id]);
  const [hours, setHours] = useState(24);
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<{ points: HistoryPoint[] }>(
      `/nodes/${node.id}/history?hours=${hours}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((r) => setPoints(r.points))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [node.id, node.lastSeen, hours]);
  const m = node.metrics;
  const location = nodeLocation(node);
  return (
    <article className="node-detail-page" aria-labelledby="node-detail-title">
      <header className="node-detail-heading">
        <button type="button" className="node-detail-back" onClick={onClose}>
          <ChevronLeft size={16} />
          返回列表
        </button>
        <div>
          <span className="node-detail-kicker">节点详情</span>
          <h1 id="node-detail-title" tabIndex={-1} ref={headingRef}>
            {node.name}
          </h1>
          <p>运行状态、资源用量与历史监控</p>
        </div>
        {admin && (
          <button type="button" onClick={onEdit}>
            <Pencil size={15} />
            编辑节点
          </button>
        )}
      </header>
      <div className="detail-body">
        <div className="detail-meta">
          <Status node={node} level={level} />
          <Flag code={node.region} />
          <span>{m?.os || "等待探针上报"}</span>
          <span>{node.group}</span>
        </div>
        <div className={`sample-banner ${node.online ? "" : "old-sample"}`}>
          <Clock3 size={15} />
          <span>
            {node.lastSeen
              ? `${node.online ? "最近样本" : "最后有效样本"} · ${sampleAge(node.lastSeen, now)}`
              : "尚未收到探针数据"}
          </span>
          {node.lastSeen > 0 && <time>{dateTime(node.lastSeen)}</time>}
        </div>
        <div className="detail-specs">
          <div>
            <small>处理器</small>
            <strong>{m?.cpuModel || "-"}</strong>
            <span>{m ? `${m.cpuCores} 核 · ${m.arch}` : "-"}</span>
          </div>
          <div>
            <small>内存</small>
            <strong>{m ? bytes(m.memoryTotal) : "-"}</strong>
            <span>{m ? `${bytes(m.memoryUsed)} 已使用` : "-"}</span>
          </div>
          <div>
            <small>磁盘</small>
            <strong>{m ? bytes(m.diskTotal) : "-"}</strong>
            <span>{m ? `${bytes(m.diskUsed)} 已使用` : "-"}</span>
          </div>
          <div>
            <small>连续运行</small>
            <strong>{m ? uptime(m.uptime) : "-"}</strong>
            <span>{dateTime(node.lastSeen)}</span>
          </div>
        </div>
        <div className="detail-readings">
          <div>
            <span>
              <Cpu size={14} />
              CPU 使用率
            </span>
            <strong>{m ? `${m.cpu.toFixed(1)}%` : "-"}</strong>
          </div>
          <div>
            <span>
              <MemoryStick size={14} />
              内存使用率
            </span>
            <strong>
              {m
                ? `${percentage(m.memoryUsed, m.memoryTotal).toFixed(1)}%`
                : "-"}
            </strong>
          </div>
          <div>
            <span>
              <ArrowUp size={14} />
              上传速率
            </span>
            <strong>{m ? `${bytes(m.uploadRate)}/s` : "-"}</strong>
          </div>
          <div>
            <span>
              <ArrowDown size={14} />
              下载速率
            </span>
            <strong>{m ? `${bytes(m.downloadRate)}/s` : "-"}</strong>
          </div>
        </div>
        <div className="detail-location">
          <MapPin size={15} />
          <span>
            {location
              ? `${node.location || regions[node.region] || node.region} · ${location.approximate ? "地区级近似位置" : "管理员指定坐标"}`
              : "位置未知"}
          </span>
          {location && (
            <small>
              {location.latitude.toFixed(3)}, {location.longitude.toFixed(3)}
            </small>
          )}
        </div>
        <div className="section-heading">
          <h3>历史监控</h3>
          <div className="segmented">
            {[
              [1, "1 小时"],
              [24, "24 小时"],
              [168, "7 天"],
            ].map(([v, l]) => (
              <button
                key={v}
                className={hours === v ? "selected" : ""}
                onClick={() => setHours(Number(v))}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="chart-loading">
            <LoaderCircle className="spin" />
            加载历史记录
          </div>
        ) : error ? (
          <div className="form-error">{error}</div>
        ) : points.length === 0 ? (
          <Empty title="暂无历史数据" subtitle="首个探针样本上报后显示" />
        ) : (
          <Suspense fallback={<div className="chart-loading">加载图表</div>}>
            <h4>资源使用率</h4>
            <Chart points={points} mode="load" dark={dark} />
            <h4>网络速率</h4>
            <Chart points={points} mode="network" dark={dark} />
          </Suspense>
        )}
        <div className="detail-network">
          <span>
            累计上传 <b>{m ? bytes(m.uploadTotal) : "-"}</b>
          </span>
          <span>
            累计下载 <b>{m ? bytes(m.downloadTotal) : "-"}</b>
          </span>
          <span>
            TCP 连接延迟{" "}
            <b>
              {m?.latencyMs === null || !m
                ? "-"
                : `${m.latencyMs.toFixed(0)} ms`}
            </b>
          </span>
          <span>
            TCP 采样失败率{" "}
            <b>
              {m?.lossPercent === null || !m
                ? "-"
                : `${m.lossPercent.toFixed(1)}%`}
            </b>
          </span>
        </div>
        {admin && (
          <div className="detail-admin">
            <div>
              <small>续费</small>
              <strong>
                {node.billingCycle === "free"
                  ? "免费"
                  : `${node.currency} ${node.price.toFixed(2)} / ${cycles[node.billingCycle]}`}
              </strong>
            </div>
            <div>
              <small>到期日期</small>
              <strong>{node.expiresAt || "未设置"}</strong>
            </div>
            <div>
              <small>公开访问</small>
              <strong>{node.visible ? "公开" : "隐藏"}</strong>
            </div>
            {node.notes && <p>{node.notes}</p>}
            <button onClick={onEdit}>
              <Pencil size={14} />
              编辑节点
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function SettingsForm({
  config,
  count,
  telegram,
  onSave,
}: {
  config: Settings;
  count: number;
  telegram: boolean;
  onSave: (data: Settings) => Promise<void>;
}) {
  const [form, setForm] = useState(config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setForm(config), [config]);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((s) => ({ ...s, [key]: value }));
  const effective = effectiveSettings(form, count);
  const reports = Math.ceil((count * 86400) / effective.reportInterval);
  const history = Math.ceil((count * 86400) / effective.historyInterval);
  return (
    <form
      className="settings-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError("");
        try {
          await onSave(form);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setSaving(false);
        }
      }}
    >
      <section className="settings-section">
        <div>
          <h3>站点信息</h3>
          <p>名称与访问权限</p>
        </div>
        <div className="form-grid">
          <Field label="站点名称" full>
            <Input
              required
              maxLength={60}
              value={form.siteName}
              onChange={(e) => set("siteName", e.target.value)}
            />
          </Field>
          <Field label="站点描述" full>
            <Input
              maxLength={160}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
          <Field label="Logo 地址" full>
            <Input
              type="url"
              placeholder="https://"
              value={form.logoUrl}
              onChange={(e) => set("logoUrl", e.target.value)}
            />
          </Field>
          <label className="check full">
            <Checkbox
              checked={form.public}
              onCheckedChange={(checked) => set("public", checked === true)}
            />
            允许游客查看匿名运行状态
          </label>
        </div>
      </section>
      <section className="settings-section">
        <div>
          <h3>采集与存储</h3>
          <p>按节点规模自动保护配额</p>
        </div>
        <div>
          <div className="form-grid">
            <Field label="上报间隔（秒）">
              <Input
                type="number"
                min={60}
                max={3600}
                step={60}
                value={form.reportInterval}
                onChange={(e) => set("reportInterval", Number(e.target.value))}
              />
            </Field>
            <Field label="历史采样间隔（秒）">
              <Input
                type="number"
                min={300}
                max={3600}
                step={60}
                value={form.historyInterval}
                onChange={(e) => set("historyInterval", Number(e.target.value))}
              />
            </Field>
            <Field label="历史保留（天）">
              <Input
                type="number"
                min={1}
                max={30}
                value={form.retentionDays}
                onChange={(e) => set("retentionDays", Number(e.target.value))}
              />
            </Field>
            <Field label="离线判定（秒）">
              <Input
                type="number"
                min={180}
                max={14400}
                step={60}
                value={form.offlineAfter}
                onChange={(e) => set("offlineAfter", Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="quota-inline">
            <div>
              <small>预计上报 / 天</small>
              <strong>{reports.toLocaleString()}</strong>
            </div>
            <div>
              <small>预计写入 / 天</small>
              <strong>{(reports * 2 + history * 4).toLocaleString()}</strong>
            </div>
            <div>
              <small>预计历史样本</small>
              <strong>{(history * form.retentionDays).toLocaleString()}</strong>
            </div>
          </div>
          <p className="muted small">
            当前规模下上报至少 {effective.reportInterval} 秒，历史采样至少{" "}
            {effective.historyInterval} 秒，离线阈值至少{" "}
            {effective.offlineAfter} 秒。{" "}
            估算含节点索引、历史写入与过期清理，不含页面请求和异常事件。实际用量以
            Cloudflare 控制台为准。
          </p>
        </div>
      </section>
      <section className="settings-section">
        <div>
          <h3>告警规则</h3>
          <p>每 5 分钟检查</p>
        </div>
        <div className="form-grid">
          <label className="check full">
            <Checkbox
              checked={form.alertsEnabled}
              onCheckedChange={(checked) =>
                set("alertsEnabled", checked === true)
              }
            />
            开启告警
          </label>
          {(
            [
              ["cpuThreshold", "CPU 使用率（%）"],
              ["memoryThreshold", "内存使用率（%）"],
              ["diskThreshold", "磁盘使用率（%）"],
              ["expiryDays", "到期提前天数"],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <Input
                type="number"
                min={1}
                max={k === "expiryDays" ? 90 : 100}
                value={form[k]}
                onChange={(e) => set(k, Number(e.target.value))}
              />
            </Field>
          ))}
          <div className="notification-status full">
            <Bell size={18} />
            <span>Telegram</span>
            <b className={telegram ? "text-green" : "muted"}>
              {telegram ? "已配置" : "未配置"}
            </b>
          </div>
        </div>
      </section>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="settings-actions">
        <button className="primary" disabled={saving}>
          <Check size={16} />
          {saving ? "保存中" : "保存设置"}
        </button>
      </div>
    </form>
  );
}

export default function App() {
  const [view, setView] = useState<View>("overview");
  const [admin, setAdmin] = useState(false);
  const [ready, setReady] = useState(false);
  const [site, setSite] = useState({
    siteName: defaults.siteName,
    description: defaults.description,
    logoUrl: "",
    public: true,
  });
  const [storedNodes, setNodes] = useState<MonitorNode[]>([]);
  const [publicNodes, setPublicNodes] = useState<PublicNode[]>([]);
  const [recent, setRecent] = useState<Record<string, RecentSample[]>>({});
  const [region, setRegion] = useState("all");
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("monitor-favorites");
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [clock, setClock] = useState(() => performance.now());
  const [timing, setTiming] = useState(() => ({
    serverTime: Date.now() / 1000,
    receivedAt: performance.now(),
    offlineAfter: defaults.offlineAfter,
  }));
  const now = timing.serverTime + Math.max(0, clock - timing.receivedAt) / 1000;
  const nodes = useMemo(
    () =>
      storedNodes.map((node) => ({
        ...node,
        online: nodeIsOnline(node, now, timing.offlineAfter),
      })),
    [storedNodes, now, timing.offlineAfter],
  );
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [config, setConfig] = useState<Settings>(defaults);
  const [telegram, setTelegram] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  // Start with the fleet, not a potentially empty health subset. A status
  // filter remains one click away after the user has context for the count.
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [cardView, setCardView] = useState(
    () => localStorage.getItem("monitor-view") !== "list",
  );
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem("monitor-theme");
    return stored === null ? true : stored === "dark";
  });
  const [sidebar, setSidebar] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<MonitorNode | null | undefined>();
  const [token, setToken] = useState<{
    token: string;
    name: string;
    id: string;
    lastSeen: number;
  } | null>(null);
  const { nodeId: detailId, openNode, closeNode, clearNode } = useNodeRoute();
  const detail = nodes.find((node) => node.id === detailId);
  const openDetail = (node: MonitorNode) => openNode(node.id);
  const [action, setAction] = useState<{
    node: MonitorNode;
    type: "archive" | "rotate-token";
  } | null>(null);
  const [archiveView, setArchiveView] = useState(false);
  const sequence = useRef(0);
  const refreshInterval = useRef(120);

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) setClock(performance.now());
    };
    const timer = setInterval(tick, 15000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("monitor-view", cardView ? "cards" : "list");
  }, [cardView]);
  useEffect(() => {
    localStorage.setItem("monitor-favorites", JSON.stringify(favorites));
  }, [favorites]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#09121b" : "#eef2f6");
    localStorage.setItem("monitor-theme", dark ? "dark" : "light");
  }, [dark]);
  const detailName = admin
    ? detail?.name
    : publicNodes.find((node) => node.id === detailId)?.name;
  useEffect(() => {
    document.title = detailName
      ? `${detailName} · ${site.siteName}`
      : site.siteName;
  }, [site.siteName, detailName]);
  useEffect(() => {
    if (admin) return;
    setNodes([]);
    setRecent({});
    setEvents([]);
    setConfig(defaults);
    setEditing(undefined);
    setToken(null);
    setAction(null);
    setNotice("");
  }, [admin]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    Promise.all([
      api<{ admin: boolean }>("/session"),
      api<typeof site>("/site"),
    ])
      .then(([session, info]) => {
        setAdmin(session.admin);
        setSite(info);
      })
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
  }, []);
  const load = useCallback(
    async (quiet = false, signal?: AbortSignal) => {
      const seq = ++sequence.current;
      if (!quiet) setLoading(true);
      try {
        if (!admin) {
          const r = await api<PublicFleet>("/nodes", "GET", undefined, signal);
          if (seq !== sequence.current) return;
          setPublicNodes(r.nodes);
          refreshInterval.current = Math.max(120, r.interval);
        } else if (!detailId && view === "settings") {
          const [r, n] = await Promise.all([
            api<{ settings: Settings; telegramConfigured: boolean }>(
              "/admin/settings",
              "GET",
              undefined,
              signal,
            ),
            api<{
              nodes: MonitorNode[];
              serverTime: number;
              offlineAfter: number;
              interval: number;
            }>("/admin/nodes", "GET", undefined, signal),
          ]);
          if (seq !== sequence.current) return;
          setConfig(r.settings);
          setTelegram(r.telegramConfigured);
          setNodes(n.nodes);
          const receivedAt = performance.now();
          setTiming({
            serverTime: n.serverTime,
            receivedAt,
            offlineAfter: n.offlineAfter,
          });
          setClock(receivedAt);
          refreshInterval.current = Math.max(120, n.interval);
        } else if (!detailId && view === "events" && admin) {
          const r = await api<{ events: MonitorEvent[] }>(
            "/admin/events",
            "GET",
            undefined,
            signal,
          );
          if (seq !== sequence.current) return;
          setEvents(r.events);
        } else {
          const r = await api<{
            nodes: MonitorNode[];
            recent?: Record<string, RecentSample[]>;
            interval: number;
            serverTime: number;
            offlineAfter: number;
          }>(
            view !== "overview" || detailId
              ? "/admin/nodes"
              : "/admin/overview",
            "GET",
            undefined,
            signal,
          );
          if (seq !== sequence.current) return;
          setNodes(r.nodes);
          setRecent(r.recent || {});
          const receivedAt = performance.now();
          setTiming({
            serverTime: r.serverTime,
            receivedAt,
            offlineAfter: r.offlineAfter,
          });
          setClock(receivedAt);
          refreshInterval.current = Math.max(120, r.interval);
        }
        setUpdatedAt(Date.now());
        setError("");
      } catch (e) {
        if ((e as Error).name === "AbortError" || seq !== sequence.current)
          return;
        if (e instanceof ApiError && e.status === 401) {
          setNodes([]);
          setPublicNodes([]);
          if (admin) {
            setAdmin(false);
            setView("overview");
          }
        }
        setError((e as Error).message);
      } finally {
        if (seq === sequence.current && !signal?.aborted) setLoading(false);
      }
    },
    [admin, view, detailId],
  );
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    void load(false, controller.signal);
    if (!detailId && view !== "overview" && view !== "nodes")
      return () => {
        controller.abort();
        sequence.current++;
      };
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (!document.hidden) await load(true, controller.signal);
        if (!controller.signal.aborted) schedule();
      }, refreshInterval.current * 1000);
    };
    schedule();
    const resume = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void load(true, controller.signal).finally(() => {
          if (!controller.signal.aborted) schedule();
        });
      }
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearTimeout(timer);
      controller.abort();
      sequence.current++;
      document.removeEventListener("visibilitychange", resume);
    };
  }, [ready, load, view, detailId]);
  useEffect(
    () => setPage(1),
    [query, group, status, region, view, archiveView],
  );
  const active = nodes.filter((n) => !n.archived);
  const levels = useMemo(
    () =>
      new Map<string, NodeLevel>(
        nodes.map((n) => [n.id, nodeLevel(n, config.expiryDays)]),
      ),
    [nodes, config.expiryDays],
  );
  const levelCounts = useMemo(() => {
    const counts: Record<NodeLevel, number> = {
      online: 0,
      warning: 0,
      offline: 0,
      pending: 0,
      archived: 0,
    };
    for (const n of active) counts[levels.get(n.id) || "pending"]++;
    return counts;
  }, [active, levels]);
  const matchesStatus = (n: MonitorNode) => {
    if (status === "online") return levels.get(n.id) === "online";
    if (status === "warning") return levels.get(n.id) === "warning";
    if (status === "offline") return !n.online && Boolean(n.lastSeen);
    if (status === "pending") return !n.lastSeen;
    if (status === "expiry") {
      const remaining = daysLeft(n.expiresAt);
      return remaining !== null && remaining <= 14;
    }
    return true;
  };
  const regionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      if (n.archived !== (view === "nodes" && archiveView)) continue;
      if (!matchesStatus(n)) continue;
      counts.set(n.region, (counts.get(n.region) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [nodes, view, archiveView, status, levels]);
  useEffect(() => {
    if (region !== "all" && !regionCounts.some(([code]) => code === region)) {
      setRegion("all");
    }
  }, [region, regionCounts]);
  const filtered = useMemo(() => {
    const result = nodes.filter((n) => {
      if (n.archived !== (view === "nodes" && archiveView)) return false;
      if (group !== "all" && n.group !== group) return false;
      if (region !== "all" && n.region !== region) return false;
      if (
        query &&
        !`${n.name} ${n.group} ${regions[n.region] || n.region} ${n.metrics?.os || ""}`
          .toLowerCase()
          .includes(query.toLowerCase())
      )
        return false;
      // The chips count each level disjointly, so the filters have to match:
      // a node in the warning state is not also listed under "online".
      if (!matchesStatus(n)) return false;
      return true;
    });
    // Starred nodes first, then healthy capacity when the overview is
    // intentionally showing every state.
    const starred = (n: MonitorNode) => Number(favorites.includes(n.id));
    if (view !== "overview") return result;
    return [...result].sort(
      (a, b) =>
        starred(b) - starred(a) ||
        (status === "all" ? Number(b.online) - Number(a.online) : 0),
    );
  }, [
    nodes,
    view,
    archiveView,
    group,
    query,
    status,
    region,
    levels,
    favorites,
  ]);
  const groups = [
    ...new Set(nodes.filter((n) => !n.archived).map((n) => n.group)),
  ];
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  const online = active.filter((n) => n.online);
  const title = nav.find((n) => n.id === view)?.title || "运行概览";
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [view, currentPage]);
  const go = (next: View) => {
    clearNode();
    setView(next);
    setSidebar(false);
    setQuery("");
    setGroup("all");
    setRegion("all");
    setStatus("all");
    setArchiveView(false);
    setPage(1);
    window.scrollTo({ top: 0 });
  };
  async function saveNode(data: NodeConfig, id?: string) {
    const r = await api<{ token?: string; node: MonitorNode }>(
      `/admin/nodes${id ? `/${id}` : ""}`,
      id ? "PUT" : "POST",
      data,
    );
    setEditing(undefined);
    if (r.token)
      setToken({
        token: r.token,
        name: data.name,
        id: r.node.id,
        lastSeen: r.node.lastSeen,
      });
    setNotice(id ? "节点已更新" : "节点已创建，等待探针接入");
    await load(true);
  }
  async function performAction() {
    if (!action) return;
    setBusy(true);
    try {
      const r = await api<{ token?: string }>(
        `/admin/nodes/${action.node.id}/${action.type}`,
        "POST",
      );
      if (r.token)
        setToken({
          token: r.token,
          name: action.node.name,
          id: action.node.id,
          lastSeen: action.node.lastSeen,
        });
      setAction(null);
      setNotice("操作已完成");
      await load(true);
    } catch (e) {
      setError((e as Error).message);
      setAction(null);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await api("/logout", "POST");
      setAdmin(false);
      setNodes([]);
      go("overview");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const nodeName = (n: MonitorNode, card = false) => (
    <div className="node-name">
      <div className="node-symbol">
        <Server size={17} />
      </div>
      <div>
        {card ? (
          <h3 className="card-title">{n.name}</h3>
        ) : (
          <a
            className="name-link"
            href={nodeDetailHref(n.id)}
            onClick={(event) => {
              if (isLocalNavigation(event)) {
                event.preventDefault();
                openDetail(n);
              }
            }}
          >
            {n.name}
          </a>
        )}
        <span>
          {n.metrics?.os || "等待探针"}
          <i>·</i>
          {n.metrics
            ? `${n.metrics.cpuCores} 核 / ${bytes(n.metrics.memoryTotal, 0)}`
            : n.group}
        </span>
      </div>
    </div>
  );

  return (
    <div className="app-shell">
      {sidebar && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭导航"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("overview");
          }}
        >
          {site.logoUrl ? (
            <img src={site.logoUrl} alt="" />
          ) : (
            <span className="brand-mark">
              <Activity size={22} />
            </span>
          )}
          <span>
            {site.siteName}
            <small>INFRASTRUCTURE MONITOR</small>
          </span>
        </a>
        <div className="workspace-label">
          工作空间 <span>{admin ? "管理员" : "访客"}</span>
        </div>
        <nav aria-label="主导航">
          {nav
            .filter((n) => admin || n.id === "overview")
            .map((n) => (
              <Button
                key={n.id}
                type="button"
                className={view === n.id ? "selected" : ""}
                onClick={() => go(n.id)}
              >
                <n.icon size={19} />
                <span>{n.title}</span>
                {admin && n.id === "overview" && active.length > 0 && (
                  <small>{active.length}</small>
                )}
              </Button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="deployment">
            <CloudMark />
            <span>
              Cloudflare Workers<small>边缘监控平台</small>
            </span>
            <span className="tiny-dot" />
          </div>
          <button
            className="account-button"
            onClick={admin ? logout : () => setLoginOpen(true)}
          >
            {admin ? <ShieldCheck size={19} /> : <LogIn size={19} />}
            <span>{admin ? "管理员已登录" : "管理员登录"}</span>
            {admin && <LogOut size={16} />}
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="top-left">
            <IconButton label="打开导航" onClick={() => setSidebar(true)}>
              <Menu />
            </IconButton>
            <button
              type="button"
              className="brand-inline"
              onClick={() => go("overview")}
            >
              {site.logoUrl ? (
                <img src={site.logoUrl} alt="" />
              ) : (
                <span className="brand-mark">
                  <Activity size={18} />
                </span>
              )}
              <span>{site.siteName}</span>
            </button>
          </div>
          <div className="top-actions">
            <span className={`live-label ${error ? "sync-error" : ""}`}>
              <i />
              {error
                ? "同步失败"
                : loading
                  ? "同步中"
                  : `刷新 ${refreshInterval.current}s`}
            </span>
            <IconButton
              label="立即刷新"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className={loading ? "spin" : ""} />
            </IconButton>
            <IconButton
              label={dark ? "切换浅色主题" : "切换深色主题"}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun /> : <Moon />}
              <span className="btn-text">{dark ? "浅色" : "深色"}</span>
            </IconButton>
            {admin && (
              <IconButton
                label="站点设置"
                className="top-action-secondary"
                onClick={() => go("settings")}
              >
                <Settings2 />
                <span className="btn-text">设置</span>
              </IconButton>
            )}
            {admin && (
              <IconButton
                label="告警记录"
                className="top-action-secondary"
                onClick={() => go("events")}
              >
                <Bell />
              </IconButton>
            )}
            <IconButton
              label={admin ? "退出登录" : "管理员登录"}
              onClick={admin ? logout : () => setLoginOpen(true)}
            >
              {admin ? <ShieldCheck /> : <LogIn />}
            </IconButton>
          </div>
        </header>
        <main
          className={`workspace-main workspace-${detailId ? "detail" : view}`}
        >
          {!admin ? (
            <PublicStatus
              nodes={publicNodes}
              nodeId={detailId}
              loading={!ready || loading}
              error={error}
              onOpen={openNode}
              onBack={closeNode}
              onRetry={() => void load()}
              onLogin={() => setLoginOpen(true)}
            />
          ) : detailId ? (
            <>
              {detail ? (
                <Detail
                  key={detail.id}
                  node={detail}
                  level={
                    levels.get(detail.id) ||
                    nodeLevel(detail, config.expiryDays)
                  }
                  dark={dark}
                  now={now}
                  admin={admin}
                  onEdit={() => setEditing(detail)}
                  onClose={closeNode}
                />
              ) : (
                <section className="node-detail-unavailable">
                  <button
                    type="button"
                    className="node-detail-back"
                    onClick={closeNode}
                  >
                    <ChevronLeft size={16} />
                    返回列表
                  </button>
                  {!ready || loading ? (
                    <div className="loading" role="status">
                      <LoaderCircle className="spin" />
                      加载节点详情
                    </div>
                  ) : (
                    <Empty
                      title={
                        error ? "暂时无法加载节点" : "节点不存在或不可访问"
                      }
                      subtitle={
                        error ||
                        "节点可能已删除、隐藏，或需要管理员登录后查看。"
                      }
                    />
                  )}
                </section>
              )}
              {error && (
                <div className="error-banner" role="alert">
                  <span>{error}</span>
                  <button
                    onClick={() =>
                      site.public ? void load() : setLoginOpen(true)
                    }
                  >
                    {site.public ? "重试" : "登录"}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {view !== "overview" && (
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">CONTROL CENTER</div>
                    <h1>{title}</h1>
                    <p>
                      {view === "nodes"
                        ? `${active.length} 台节点 · ${groups.length} 个分组`
                        : view === "billing"
                          ? "订阅费用与续费日期"
                          : view === "events"
                            ? "最近 100 条状态变化"
                            : "站点、采集与通知配置"}
                    </p>
                  </div>
                  <div className="heading-actions">
                    {view !== "settings" && (
                      <IconButton
                        label={
                          view === "events" ? "刷新告警记录" : "刷新节点数据"
                        }
                        onClick={() => void load()}
                        disabled={loading}
                      >
                        <RefreshCw className={loading ? "spin" : ""} />
                      </IconButton>
                    )}
                    {admin && ["nodes", "overview"].includes(view) && (
                      <button
                        className="primary"
                        onClick={() => setEditing(null)}
                      >
                        <Plus size={17} />
                        添加节点
                      </button>
                    )}
                  </div>
                </div>
              )}
              {error && (
                <div className="error-banner" role="alert">
                  <span>{error}</span>
                  <button
                    onClick={() =>
                      site.public ? void load() : setLoginOpen(true)
                    }
                  >
                    {site.public ? "重试" : "登录"}
                  </button>
                </div>
              )}
              {view === "overview" && (
                <>
                  <section className="dash-top">
                    <StatDeck nodes={active} online={online} recent={recent} />
                    <div className="globe-panel">
                      <Suspense
                        fallback={
                          <div className="geo-loading">加载全球节点</div>
                        }
                      >
                        <Globe
                          levels={levels}
                          nodes={active}
                          onSelect={openDetail}
                          dark={dark}
                          compact
                        />
                      </Suspense>
                    </div>
                  </section>
                </>
              )}
              {["overview", "nodes", "billing"].includes(view) && (
                <>
                  <div className="fleet-bar">
                    <h2>
                      {view === "overview"
                        ? status === "all"
                          ? "全部节点"
                          : `${levelLabel[status as NodeLevel] ?? "全部"}节点`
                        : title}
                      <span className="count-chip">{filtered.length}</span>
                    </h2>
                    {view !== "billing" && !archiveView && (
                      <div
                        className="chip-row"
                        role="group"
                        aria-label="节点状态"
                      >
                        {(
                          [
                            ["all", "全部", active.length],
                            ["online", "在线", levelCounts.online],
                            ["warning", "警告", levelCounts.warning],
                            ["offline", "离线", levelCounts.offline],
                            ["pending", "待接入", levelCounts.pending],
                          ] as [string, string, number][]
                        ).map(([key, label, count]) => (
                          <button
                            key={key}
                            type="button"
                            className={`chip ${key} ${status === key ? "on" : ""}`}
                            aria-pressed={status === key}
                            onClick={() => setStatus(key)}
                          >
                            {key !== "all" && <i className="state-dot" />}
                            {label}
                            <b className="num">{count}</b>
                          </button>
                        ))}
                      </div>
                    )}
                    {regionCounts.length > 1 && (
                      <div
                        className="chip-row"
                        role="group"
                        aria-label="地区筛选"
                      >
                        <button
                          type="button"
                          className={`chip ${region === "all" ? "on" : ""}`}
                          aria-pressed={region === "all"}
                          onClick={() => setRegion("all")}
                        >
                          全部地区
                        </button>
                        {regionCounts.map(([code, count]) => (
                          <button
                            key={code}
                            type="button"
                            className={`chip ${region === code ? "on" : ""}`}
                            aria-pressed={region === code}
                            onClick={() => setRegion(code)}
                          >
                            {regions[code] || code}
                            <b className="num">{count}</b>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="fleet-tools">
                      <div className="search ui-search">
                        <Search size={15} />
                        <Input
                          aria-label="搜索节点"
                          placeholder="搜索节点"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                        {query && (
                          <IconButton
                            label="清除搜索"
                            onClick={() => setQuery("")}
                          >
                            <X size={14} />
                          </IconButton>
                        )}
                      </div>
                      {view === "nodes" && (
                        <>
                          <Select
                            aria-label="分组筛选"
                            value={group}
                            onChange={(e) => setGroup(e.target.value)}
                          >
                            <option value="all">全部分组</option>
                            {groups.map((g) => (
                              <option key={g}>{g}</option>
                            ))}
                          </Select>
                          <IconButton
                            label="已归档"
                            active={archiveView}
                            onClick={() => setArchiveView(!archiveView)}
                          >
                            <Archive />
                          </IconButton>
                          <IconButton
                            label="导出配置"
                            onClick={async () => {
                              try {
                                download(
                                  "monitor-backup.json",
                                  await api("/admin/export"),
                                );
                              } catch (e) {
                                setError((e as Error).message);
                              }
                            }}
                          >
                            <Download />
                          </IconButton>
                        </>
                      )}
                      {view === "overview" && (
                        <div
                          className="segmented view-switch"
                          role="group"
                          aria-label="视图切换"
                        >
                          <IconButton
                            label="卡片视图"
                            active={cardView}
                            onClick={() => setCardView(true)}
                          >
                            <LayoutGrid />
                          </IconButton>
                          <IconButton
                            label="列表视图"
                            active={!cardView}
                            onClick={() => setCardView(false)}
                          >
                            <List />
                          </IconButton>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="fleet-results" key={view}>
                    {loading && nodes.length === 0 ? (
                      <div className="loading">
                        <LoaderCircle className="spin" />
                        加载节点
                      </div>
                    ) : filtered.length === 0 ? (
                      <Empty
                        title={
                          active.length === 0
                            ? "尚未添加服务器"
                            : "没有匹配的节点"
                        }
                        subtitle={
                          active.length === 0
                            ? "节点接入后将在这里显示运行状态"
                            : "调整搜索或筛选条件"
                        }
                        action={
                          admin && active.length === 0 ? (
                            <button
                              className="primary"
                              onClick={() => setEditing(null)}
                            >
                              <Plus size={16} />
                              添加节点
                            </button>
                          ) : active.length ? (
                            <button
                              type="button"
                              className="primary"
                              onClick={() => {
                                setQuery("");
                                setGroup("all");
                                setRegion("all");
                                setStatus("all");
                              }}
                            >
                              查看全部节点
                            </button>
                          ) : undefined
                        }
                      />
                    ) : cardView && view === "overview" ? (
                      <div className="node-grid">
                        {visible.map((n) => (
                          <FleetCard
                            key={n.id}
                            node={n}
                            level={levels.get(n.id) || "pending"}
                            samples={recent[n.id] || []}
                            favorite={favorites.includes(n.id)}
                            onOpen={() => openDetail(n)}
                            onFavorite={() =>
                              setFavorites((list) =>
                                list.includes(n.id)
                                  ? list.filter((id) => id !== n.id)
                                  : [...list, n.id],
                              )
                            }
                            onMenu={() => openDetail(n)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="table-scroll" key={view}>
                        <table className={`fleet-table ${view}`}>
                          <thead>
                            <tr>
                              <th>节点名称</th>
                              <th>状态</th>
                              <th>地区 / 分组</th>
                              {view === "overview" ? (
                                <>
                                  <th>CPU</th>
                                  <th>内存</th>
                                  <th>磁盘</th>
                                  <th>网络 ↑ / ↓</th>
                                  <th>最近上报</th>
                                </>
                              ) : view === "billing" ? (
                                <>
                                  <th>金额</th>
                                  <th>计费周期</th>
                                  <th>到期日期</th>
                                  <th>剩余时间</th>
                                  <th />
                                </>
                              ) : (
                                <>
                                  <th>公开访问</th>
                                  <th>最近上报</th>
                                  <th>到期日期</th>
                                  <th>操作</th>
                                </>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {visible.map((n) => (
                              <tr
                                key={n.id}
                                className={
                                  !n.online && n.lastSeen ? "node-offline" : ""
                                }
                              >
                                <td data-label="节点名称">{nodeName(n)}</td>
                                <td data-label="状态">
                                  <Status node={n} level={levels.get(n.id)} />
                                </td>
                                <td data-label="地区 / 分组">
                                  <div className="region-group">
                                    <span>
                                      <Flag code={n.region} />
                                      {regions[n.region] || n.region}
                                    </span>
                                    <small>{n.group}</small>
                                  </div>
                                </td>
                                {view === "overview" ? (
                                  <>
                                    <td data-label="CPU">
                                      {n.online && n.metrics ? (
                                        <Meter value={n.metrics.cpu} />
                                      ) : (
                                        "-"
                                      )}
                                    </td>
                                    <td data-label="内存">
                                      {n.online && n.metrics ? (
                                        <Meter
                                          value={percentage(
                                            n.metrics.memoryUsed,
                                            n.metrics.memoryTotal,
                                          )}
                                          color="blue"
                                        />
                                      ) : (
                                        "-"
                                      )}
                                    </td>
                                    <td data-label="磁盘">
                                      {n.online && n.metrics ? (
                                        <Meter
                                          value={percentage(
                                            n.metrics.diskUsed,
                                            n.metrics.diskTotal,
                                          )}
                                          color="amber"
                                        />
                                      ) : (
                                        "-"
                                      )}
                                    </td>
                                    <td>
                                      <div className="network-cell">
                                        <span>
                                          <ArrowUp size={12} />
                                          {n.online
                                            ? `${bytes(n.metrics?.uploadRate || 0)}/s`
                                            : "-"}
                                        </span>
                                        <span>
                                          <ArrowDown size={12} />
                                          {n.online
                                            ? `${bytes(n.metrics?.downloadRate || 0)}/s`
                                            : "-"}
                                        </span>
                                      </div>
                                    </td>
                                    <td>
                                      <div
                                        className="last-report"
                                        title={dateTime(n.lastSeen)}
                                      >
                                        <span>
                                          {sampleAge(n.lastSeen, now)}
                                        </span>
                                        <small>
                                          {n.online && n.metrics
                                            ? `运行 ${uptime(n.metrics.uptime)}`
                                            : n.lastSeen
                                              ? "数据已过期"
                                              : "等待首报"}
                                        </small>
                                      </div>
                                    </td>
                                  </>
                                ) : view === "billing" ? (
                                  <>
                                    <td className="strong" data-label="金额">
                                      {n.currency} {n.price.toFixed(2)}
                                    </td>
                                    <td data-label="计费周期">
                                      {cycles[n.billingCycle]}
                                    </td>
                                    <td data-label="到期日期">
                                      {n.expiresAt || "-"}
                                    </td>
                                    <td
                                      data-label="剩余时间"
                                      className={
                                        daysLeft(n.expiresAt) !== null &&
                                        daysLeft(n.expiresAt)! <= 14
                                          ? "text-amber"
                                          : ""
                                      }
                                    >
                                      {daysLeft(n.expiresAt) === null
                                        ? "-"
                                        : daysLeft(n.expiresAt)! < 0
                                          ? `已过期 ${Math.abs(daysLeft(n.expiresAt)!)} 天`
                                          : `${daysLeft(n.expiresAt)} 天`}
                                    </td>
                                    <td data-label="操作">
                                      <IconButton
                                        label={`编辑 ${n.name}`}
                                        onClick={() => setEditing(n)}
                                      >
                                        <Pencil />
                                      </IconButton>
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td data-label="公开访问">
                                      {n.visible ? (
                                        <span className="visibility">
                                          <Eye size={14} />
                                          公开
                                        </span>
                                      ) : (
                                        <span className="visibility muted">
                                          <EyeOff size={14} />
                                          隐藏
                                        </span>
                                      )}
                                    </td>
                                    <td data-label="最近上报">
                                      <div
                                        className="last-report"
                                        title={dateTime(n.lastSeen)}
                                      >
                                        <span>
                                          {sampleAge(n.lastSeen, now)}
                                        </span>
                                        <small>
                                          {n.lastSeen
                                            ? dateTime(n.lastSeen)
                                            : "等待首报"}
                                        </small>
                                      </div>
                                    </td>
                                    <td data-label="到期日期">
                                      {n.expiresAt || "-"}
                                    </td>
                                    <td data-label="操作">
                                      <div className="row-actions">
                                        <IconButton
                                          label={`编辑 ${n.name}`}
                                          onClick={() => setEditing(n)}
                                        >
                                          <Pencil />
                                        </IconButton>
                                        {n.archived ? (
                                          <IconButton
                                            label={`恢复 ${n.name}`}
                                            onClick={async () => {
                                              try {
                                                await api(
                                                  `/admin/nodes/${n.id}/restore`,
                                                  "POST",
                                                );
                                                setNotice("节点已恢复");
                                                await load(true);
                                              } catch (e) {
                                                setError((e as Error).message);
                                              }
                                            }}
                                          >
                                            <RotateCcw />
                                          </IconButton>
                                        ) : (
                                          <>
                                            <IconButton
                                              label={`重置 ${n.name} 密钥`}
                                              onClick={() =>
                                                setAction({
                                                  node: n,
                                                  type: "rotate-token",
                                                })
                                              }
                                            >
                                              <KeyRound />
                                            </IconButton>
                                            <IconButton
                                              label={`归档 ${n.name}`}
                                              onClick={() =>
                                                setAction({
                                                  node: n,
                                                  type: "archive",
                                                })
                                              }
                                            >
                                              <Archive />
                                            </IconButton>
                                          </>
                                        )}
                                      </div>
                                    </td>
                                  </>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {filtered.length > 0 && (
                      <div className="pagination">
                        <span>
                          共 {filtered.length} 台节点 · 显示{" "}
                          {(currentPage - 1) * 20 + 1}–
                          {Math.min(currentPage * 20, filtered.length)}
                        </span>
                        <div>
                          <IconButton
                            label="上一页"
                            disabled={currentPage === 1}
                            onClick={() => setPage(currentPage - 1)}
                          >
                            <ChevronLeft />
                          </IconButton>
                          <span>
                            {currentPage} / {pages}
                          </span>
                          <IconButton
                            label="下一页"
                            disabled={currentPage >= pages}
                            onClick={() => setPage(currentPage + 1)}
                          >
                            <ChevronRight />
                          </IconButton>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
              {view === "billing" && (
                <section className="billing-summary" aria-label="费用概览">
                  <div className="billing-totals">
                    {[
                      ...new Set(
                        active
                          .filter((n) => n.billingCycle !== "free")
                          .map((n) => n.currency),
                      ),
                    ].map((currency) => (
                      <div key={currency}>
                        <small>月均费用 · {currency}</small>
                        <strong>
                          {active
                            .filter(
                              (n) =>
                                n.currency === currency &&
                                n.billingCycle !== "free",
                            )
                            .reduce(
                              (v, n) =>
                                v +
                                n.price /
                                  (n.billingCycle === "yearly"
                                    ? 12
                                    : n.billingCycle === "quarterly"
                                      ? 3
                                      : 1),
                              0,
                            )
                            .toFixed(2)}
                        </strong>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {view === "events" &&
                (loading ? (
                  <div className="loading">
                    <LoaderCircle className="spin" />
                    加载告警
                  </div>
                ) : events.length === 0 ? (
                  <Empty
                    icon={<Bell size={34} strokeWidth={1.3} />}
                    title="暂无告警记录"
                    subtitle="状态变化后将生成记录"
                  />
                ) : (
                  <div className="event-list">
                    {events.map((e) => (
                      <article key={e.id}>
                        <span className={`event-icon ${e.kind}`}>
                          {e.kind === "recovery" ? (
                            <CheckCircle2 size={19} />
                          ) : (
                            <Bell size={19} />
                          )}
                        </span>
                        <div>
                          <strong>{e.name}</strong>
                          <p>{e.message}</p>
                          <small>{dateTime(e.created_at)}</small>
                        </div>
                        <span className="event-delivery">
                          {e.delivered ? "已通知" : "已记录"}
                        </span>
                      </article>
                    ))}
                  </div>
                ))}
              {view === "settings" &&
                (loading ? (
                  <div className="loading">
                    <LoaderCircle className="spin" />
                    加载设置
                  </div>
                ) : (
                  <SettingsForm
                    config={config}
                    count={active.length}
                    telegram={telegram}
                    onSave={async (data) => {
                      await api("/admin/settings", "PUT", data);
                      setSite(data);
                      setNotice("设置已保存");
                      await load(true);
                    }}
                  />
                ))}
            </>
          )}
          <div className="site-meta">
            {admin && <VisitorBar />}
            <footer>
              <span>
                {site.siteName} <i>·</i> CF VPS Monitor
              </span>
              <a
                href="https://developers.cloudflare.com/workers/platform/limits/"
                target="_blank"
                rel="noreferrer"
              >
                平台额度 <ExternalLink size={12} />
              </a>
            </footer>
          </div>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {notice}
        </div>
      )}
      {loginOpen && (
        <Modal
          title="管理员登录"
          onClose={() => {
            setLoginOpen(false);
            setPassword("");
            setLoginError("");
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setLoginError("");
              try {
                await api("/login", "POST", { password });
                setAdmin(true);
                setPublicNodes([]);
                clearNode();
                setLoginOpen(false);
                setPassword("");
                setNotice("已登录");
              } catch (e) {
                setLoginError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="login-body">
              <div className="login-emblem">
                <ShieldCheck size={30} />
              </div>
              <Field label="管理员密码">
                <Input
                  autoFocus
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              {loginError && (
                <div className="form-error" role="alert">
                  {loginError}
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="primary" disabled={busy}>
                <LogIn size={16} />
                {busy ? "登录中" : "登录后台"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {admin && editing !== undefined && (
        <NodeForm
          node={editing}
          onClose={() => setEditing(undefined)}
          onSave={saveNode}
        />
      )}
      {admin && token && (
        <TokenModal
          value={token}
          interval={refreshInterval.current}
          onConnected={(node) => {
            setNodes((previous) =>
              previous.map((n) => (n.id === node.id ? node : n)),
            );
            void load(true);
          }}
          onClose={() => setToken(null)}
        />
      )}
      {admin && action && (
        <Modal
          title={action.type === "archive" ? "归档节点" : "重置接入密钥"}
          onClose={() => setAction(null)}
        >
          <div className="token-body">
            <p>
              {action.type === "archive"
                ? `归档「${action.node.name}」后将停止接收上报，并从监控页移除。之后可在已归档列表恢复。`
                : `重置「${action.node.name}」后，旧密钥立即失效。需要更新此节点的探针配置。`}
            </p>
          </div>
          <div className="modal-actions">
            <button onClick={() => setAction(null)}>取消</button>
            <button className="primary" disabled={busy} onClick={performAction}>
              确认{action.type === "archive" ? "归档" : "重置"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function CloudMark() {
  return (
    <span className="cloud-mark">
      <Globe2 size={20} />
    </span>
  );
}
