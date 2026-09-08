import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, Radio, Sparkles, X } from "lucide-react";
import type { MonitorNode } from "../shared/types";
import {
  locationName,
  locationStatus,
  mapNodeStatus,
  mapStatusLabels,
  type LocationGroup,
  type NodeLevels,
  type MapStatus,
} from "./map-model";

export function useMapMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function MapEffectsToggle({
  enabled,
  reduced,
  onToggle,
}: {
  enabled: boolean;
  reduced: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="map-effects-toggle"
      aria-label={enabled ? "暂停节点特效" : "开启节点特效"}
      aria-pressed={enabled}
      disabled={reduced}
      title={reduced ? "已遵循系统减少动态效果设置" : "切换节点波纹与信号动效"}
      onClick={onToggle}
    >
      <Sparkles size={12} />
      <span>特效{enabled ? "开" : "关"}</span>
    </button>
  );
}

export function MapLegend({
  nodes,
  levels,
}: {
  nodes: MonitorNode[];
  levels: NodeLevels;
}) {
  const counts: Record<MapStatus, number> = {
    online: 0,
    warning: 0,
    offline: 0,
    pending: 0,
  };
  nodes.forEach((node) => {
    if (!node.archived) counts[mapNodeStatus(node, levels)]++;
  });
  return (
    <div className="map-health-legend" aria-label="节点状态图例">
      {(["online", "warning", "offline", "pending"] as const).map((status) => (
        <span key={status} className={status} title={mapStatusLabels[status]}>
          <i />
          {
            {
              online: "正常",
              warning: "警告",
              offline: "离线",
              pending: "待接入",
            }[status]
          }
          <b>{counts[status]}</b>
        </span>
      ))}
    </div>
  );
}

export function MapLocationInfo({
  location,
  preview,
  levels,
  onSelect,
}: {
  location?: LocationGroup;
  preview: boolean;
  levels: NodeLevels;
  onSelect: (node: MonitorNode) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  useEffect(() => setExpanded(false), [location?.key]);
  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setExpanded(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded]);
  if (!location)
    return (
      <div className="map-empty-state">
        <Radio size={20} />
        <strong>等待节点坐标</strong>
        <span>为节点设置地区后，即可在这里查看状态</span>
      </div>
    );
  const status = locationStatus(location, levels);
  const online = location.nodes.filter((node) => node.online).length;
  const warnings = location.nodes.filter(
    (node) => mapNodeStatus(node, levels) === "warning",
  ).length;
  const offline = location.nodes.filter(
    (node) => mapNodeStatus(node, levels) === "offline",
  ).length;
  return (
    <div
      className={`map-location-info ${status}`}
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setExpanded(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        type="button"
        className="map-location-trigger"
        ref={trigger}
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        onClick={() => setExpanded((value) => !value)}
      >
        <i className={`map-node-state ${status}`} />
        <span>
          <strong>
            {locationName(location)}{" "}
            <small>{preview ? "预览" : `${location.nodes.length} 台`}</small>
          </strong>
          <small>
            {online}/{location.nodes.length} 在线
            {warnings ? ` · ${warnings} 警告` : ""}
            {offline ? ` · ${offline} 离线` : ""}
          </small>
        </span>
        <ChevronDown size={13} className={expanded ? "expanded" : ""} />
      </button>
      {expanded && (
        <div
          className="map-node-popover"
          id={listId}
          role="region"
          aria-label={`${locationName(location)}节点列表`}
        >
          <div className="map-popover-heading">
            <strong>{locationName(location)}</strong>
            <button
              type="button"
              aria-label="关闭区域节点列表"
              onClick={() => {
                setExpanded(false);
                trigger.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          </div>
          <p>
            {location.approximate ? "地区参考位置" : "管理员指定坐标"} ·{" "}
            {location.latitude.toFixed(2)}°, {location.longitude.toFixed(2)}°
          </p>
          <div className="map-popover-nodes">
            {location.nodes.map((node) => (
              <button
                type="button"
                key={node.id}
                onClick={() => onSelect(node)}
              >
                <i
                  className={`map-node-state ${mapNodeStatus(node, levels)}`}
                />
                <span>
                  <strong>{node.name}</strong>
                  <small>
                    {mapStatusLabels[mapNodeStatus(node, levels)]}
                    {node.online && node.metrics?.latencyMs != null
                      ? ` · ${Math.round(node.metrics.latencyMs)} ms`
                      : ""}
                  </small>
                </span>
                <ArrowUpRight size={14} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
