import { useState } from "react";
import { createRoot } from "react-dom/client";
import Globe from "../../src/Globe";
import { nodeLevel } from "../../src/Overview";
import type { MonitorNode } from "../../shared/types";
import "../../src/style.css";
import "../../src/glass.css";
import "../../src/dashboard.css";
import "../../src/map-layout.css";

const nodes: MonitorNode[] = [
  { id: "healthy-hk", name: "香港 · 正常节点", region: "HK", online: true },
  { id: "warning-jp", name: "东京 · CPU 负载警告", region: "JP", online: true },
  { id: "offline-us", name: "美国 · 离线节点", region: "US", online: false },
  { id: "healthy-sg", name: "新加坡 · 正常节点", region: "SG", online: true },
  { id: "mixed-de-ok", name: "德国 · 正常节点", region: "DE", online: true },
  { id: "mixed-de-down", name: "德国 · 离线节点", region: "DE", online: false },
  { id: "pending-au", name: "澳大利亚 · 待接入", region: "AU", online: false },
].map((entry) => ({
  createdAt: 1,
  lastSeen: entry.id.startsWith("pending") ? 0 : Date.now() / 1000,
  archived: false,
  group: "",
  visible: true,
  sortOrder: 0,
  price: 0,
  currency: "USD",
  billingCycle: "monthly",
  expiresAt: null,
  notes: "",
  latitude: null,
  longitude: null,
  location: "",
  trafficLimit: 0,
  metrics: {
    os: "Linux",
    arch: "amd64",
    cpuModel: "",
    cpuCores: 2,
    cpu: entry.id.startsWith("warning") ? 92 : 15,
    memoryUsed: 25,
    memoryTotal: 100,
    diskUsed: 15,
    diskTotal: 100,
    uploadRate: 100,
    downloadRate: 300,
    uploadTotal: 1000,
    downloadTotal: 2000,
    uptime: 100,
    latencyMs: 24,
    lossPercent: 0,
  },
  ...entry,
}));
const levels = new Map(nodes.map((node) => [node.id, nodeLevel(node, 7)]));
function Preview() {
  const [dark, setDark] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [detail, setDetail] = useState<MonitorNode | null>(null);
  return (
    <main
      className="workspace-overview"
      style={{ padding: 12, maxWidth: 1100, margin: "0 auto" }}
    >
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h1 style={{ fontSize: 18, marginRight: "auto" }}>
          地图交互验收 · 演示数据
        </h1>
        <button
          onClick={() => {
            setDark(!dark);
            document.documentElement.dataset.theme = dark ? "light" : "dark";
          }}
        >
          切换主题
        </button>
        <button onClick={() => setEmpty(!empty)}>切换空状态</button>
      </header>
      <section
        className="dash-top"
        style={{ gridTemplateColumns: "minmax(0, 1fr)", padding: 0 }}
      >
        <div className="globe-panel">
          <Globe
            nodes={empty ? [] : nodes}
            levels={levels}
            onSelect={setDetail}
            dark={dark}
            compact
          />
        </div>
      </section>
      {detail && (
        <p role="status">
          已打开节点详情：{detail.name}{" "}
          <button onClick={() => setDetail(null)}>关闭详情</button>
        </p>
      )}
      <p style={{ fontSize: 12, color: "var(--dash-muted)", marginTop: 20 }}>
        检查正常绿波纹、警告黄波纹、离线红断续信号，以及德国混合节点组。此页不会修改后台数据。
      </p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
