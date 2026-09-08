import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  useId,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import * as THREE from "three";
import landTopology from "./assets/land-110m.json";
import earthTextureUrl from "./assets/earth-blue-marble.jpg";
import {
  Globe2,
  MapPin,
  Pause,
  Play,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { globePosition, groupLocations } from "../shared/locations";
import type { MonitorNode } from "../shared/types";
import { Select } from "./components/ui";
import {
  locationStatus,
  locationName,
  mapStatusLabels,
  mapConnections,
  type NodeLevels,
  type MapStatus,
} from "./map-model";
import {
  MapEffectsToggle,
  MapLegend,
  MapLocationInfo,
  useMapMotion,
} from "./MapInterface";
import { buildDistributionLayer, buildGlobeGrid } from "./MapScene";
import "./map-effects.css";

type RotationState = "idle" | "interacting" | "rotating";

const rotationSpeedPresets = [
  { value: 0.08, label: "慢" },
  { value: 0.14, label: "标准" },
  { value: 0.22, label: "快" },
] as const;

type ContourPath = readonly (readonly [number, number])[];

interface LandTopology {
  transform: {
    scale: readonly [number, number];
    translate: readonly [number, number];
  };
  arcs: readonly (readonly (readonly [number, number])[])[];
  objects: {
    land: {
      geometries: readonly {
        type: "MultiPolygon";
        arcs: readonly (readonly (readonly number[])[])[];
      }[];
    };
  };
}

/**
 * The dashboard carries a small, simplified Natural Earth land topology in
 * the app bundle. Decoding it here keeps both projections accurate without a
 * network request or a map service at runtime.
 */
function decodeLandContours(topology: LandTopology): ContourPath[] {
  const decodedArcs = new Map<number, ContourPath>();
  const decodeArc = (reference: number) => {
    const reversed = reference < 0;
    const index = reversed ? ~reference : reference;
    const cached = decodedArcs.get(index);
    const decoded =
      cached ||
      (() => {
        let x = 0;
        let y = 0;
        const path = topology.arcs[index].map(([deltaX, deltaY]) => {
          x += deltaX;
          y += deltaY;
          // The rest of this component uses [latitude, longitude] pairs.
          // TopoJSON stores its coordinate tuples in the opposite order.
          return [
            topology.transform.translate[1] + y * topology.transform.scale[1],
            topology.transform.translate[0] + x * topology.transform.scale[0],
          ] as const;
        });
        decodedArcs.set(index, path);
        return path;
      })();
    return reversed ? [...decoded].reverse() : decoded;
  };

  return topology.objects.land.geometries.flatMap((geometry) =>
    geometry.arcs.flatMap((polygon) =>
      polygon.map((ring) =>
        ring.reduce<readonly (readonly [number, number])[]>(
          (path, reference) => {
            const arc = decodeArc(reference);
            return path.length ? [...path, ...arc.slice(1)] : arc;
          },
          [],
        ),
      ),
    ),
  );
}

const landContours = decodeLandContours(
  landTopology as unknown as LandTopology,
);

type LocationGroup = ReturnType<typeof groupLocations>[number];

type FlatDistributionRoute = {
  key: string;
  path: string;
  duration: number;
  delay: number;
  status: MapStatus;
};

function projectFlatPoint(latitude: number, longitude: number) {
  return {
    x: ((longitude + 180) / 360) * 1000,
    y: ((90 - latitude) / 180) * 500,
  };
}

function contourPath(contour: ContourPath) {
  const [[firstLatitude, firstLongitude], ...remaining] = contour;
  const first = projectFlatPoint(firstLatitude, firstLongitude);
  let result = `M${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  let previousLatitude = firstLatitude;
  let previousLongitude = firstLongitude;
  for (const [latitude, longitude] of remaining) {
    const point = projectFlatPoint(latitude, longitude);
    if (Math.abs(longitude - previousLongitude) > 180) {
      const movesEast = previousLongitude > longitude;
      const boundaryLongitude = movesEast ? 180 : -180;
      const adjustedLongitude = longitude + (movesEast ? 360 : -360);
      const travel =
        (boundaryLongitude - previousLongitude) /
        (adjustedLongitude - previousLongitude);
      const seamLatitude =
        previousLatitude + (latitude - previousLatitude) * travel;
      const seam = projectFlatPoint(seamLatitude, boundaryLongitude);
      result += ` L${movesEast ? "1000" : "0"} ${seam.y.toFixed(1)}`;
      result += ` M${movesEast ? "0" : "1000"} ${seam.y.toFixed(1)}`;
    }
    result += ` L${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    previousLatitude = latitude;
    previousLongitude = longitude;
  }
  return `${result} Z`;
}

const flatLandPaths = landContours.map(contourPath);

type FlatMarkerPosition = ReturnType<typeof projectFlatPoint>;
type FlatMapPan = { x: number; y: number };

function clampFlatMapPan(position: FlatMapPan, zoom: number): FlatMapPan {
  const maxX = (zoom - 1) * 500;
  const maxY = (zoom - 1) * 250;
  return {
    x: THREE.MathUtils.clamp(position.x, -maxX, maxX),
    y: THREE.MathUtils.clamp(position.y, -maxY, maxY),
  };
}

/**
 * Nearby regional reference points are visually fanned out just enough to
 * make every status target distinct. The map stays label-free and the source
 * coordinates remain available through each control's accessible name.
 */
function spreadFlatMapMarkers(locations: LocationGroup[]) {
  const points = locations.map((location) => ({
    key: location.key,
    ...projectFlatPoint(location.latitude, location.longitude),
  }));
  const pending = new Set(points.map((_, index) => index));
  const positions = new Map<string, FlatMarkerPosition>();

  while (pending.size) {
    const [firstIndex] = pending;
    pending.delete(firstIndex);
    const cluster = [firstIndex];

    for (let cursor = 0; cursor < cluster.length; cursor++) {
      const current = points[cluster[cursor]];
      for (const candidateIndex of [...pending]) {
        const candidate = points[candidateIndex];
        if (Math.hypot(candidate.x - current.x, candidate.y - current.y) < 28) {
          pending.delete(candidateIndex);
          cluster.push(candidateIndex);
        }
      }
    }

    const members = cluster
      .map((index) => points[index])
      .sort((first, second) => first.key.localeCompare(second.key));
    if (members.length === 1) {
      positions.set(members[0].key, members[0]);
      continue;
    }

    const center = members.reduce(
      (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
      { x: 0, y: 0 },
    );
    center.x /= members.length;
    center.y /= members.length;
    const radius = 14 + Math.min(14, members.length * 3);
    members.forEach((point, index) => {
      const angle = -Math.PI / 2 + (index / members.length) * Math.PI * 2;
      positions.set(point.key, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      });
    });
  }

  return positions;
}

function curvedFlatPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  const arcHeight = Math.min(84, Math.max(28, span * 0.16));
  const controlX = (from.x + to.x) / 2;
  const controlY = Math.max(22, Math.min(478, (from.y + to.y) / 2 - arcHeight));
  return `M${from.x.toFixed(1)} ${from.y.toFixed(1)} Q${controlX.toFixed(1)} ${controlY.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

function flatDistributionRoutes(
  locations: LocationGroup[],
  selectedKey: string,
  levels: NodeLevels,
  positions: Map<string, FlatMarkerPosition>,
): FlatDistributionRoute[] {
  return mapConnections(locations, selectedKey, levels).flatMap(
    ({ origin, destination, status }, index) => {
      const start =
        positions.get(origin.key) ||
        projectFlatPoint(origin.latitude, origin.longitude);
      const end =
        positions.get(destination.key) ||
        projectFlatPoint(destination.latitude, destination.longitude);
      const duration = 3.8 + index * 0.35;
      const delay = -(index * 0.6);
      if (Math.abs(end.x - start.x) <= 500)
        return [
          {
            key: destination.key,
            path: curvedFlatPath(start, end),
            duration,
            delay,
            status,
          },
        ];
      const exitsLeft = end.x > start.x;
      const exit = { x: exitsLeft ? 0 : 1000, y: (start.y + end.y) / 2 };
      const entry = { x: exitsLeft ? 1000 : 0, y: exit.y };
      return [
        {
          key: `${destination.key}-out`,
          path: curvedFlatPath(start, exit),
          duration,
          delay,
          status,
        },
        {
          key: `${destination.key}-in`,
          path: curvedFlatPath(entry, end),
          duration,
          delay: delay - duration / 2,
          status,
        },
      ];
    },
  );
}

type MapEffectProps = {
  levels: NodeLevels;
  effects: boolean;
  reduced: boolean;
  onToggleEffects: () => void;
  touchActive: boolean;
  onToggleTouch: () => void;
};

function MapTouchToggle({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="map-touch-toggle"
      aria-pressed={active}
      aria-label={
        active ? "结束地图手势操作，恢复页面滑动" : "开启地图手势操作"
      }
      onClick={onToggle}
    >
      {active ? "完成操作" : "操作地图"}
    </button>
  );
}

type MapView = "flat" | "globe";

function ViewSwitcher({
  view,
  onChange,
}: {
  view: MapView;
  onChange: (view: MapView) => void;
}) {
  const changeView = (next: MapView) => {
    if (next === view) return;
    onChange(next);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(
          `.map-view-switcher [data-map-view="${next}"]`,
        )
        ?.focus();
    });
  };
  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    current: MapView,
  ) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    if (event.key === "Home") changeView("flat");
    else if (event.key === "End") changeView("globe");
    else changeView(current === "flat" ? "globe" : "flat");
  };
  return (
    <div className="map-view-switcher" role="group" aria-label="地图视图">
      <button
        type="button"
        className={view === "flat" ? "active" : ""}
        data-map-view="flat"
        aria-current={view === "flat" ? "true" : undefined}
        onClick={() => changeView("flat")}
        onKeyDown={(event) => handleKeyDown(event, "flat")}
      >
        世界地图
      </button>
      <button
        type="button"
        className={view === "globe" ? "active" : ""}
        data-map-view="globe"
        aria-current={view === "globe" ? "true" : undefined}
        onClick={() => changeView("globe")}
        onKeyDown={(event) => handleKeyDown(event, "globe")}
      >
        3D 地球
      </button>
    </div>
  );
}

function NodeGroupPicker({
  locations,
  value,
  onChange,
}: {
  locations: LocationGroup[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <label className="map-location-picker">
      <span className="sr-only">选择节点组</span>
      <Select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="选择节点组"
      >
        {locations.map((location, index) => (
          <option key={location.key} value={location.key}>
            {locationName(location)} · {location.nodes.length} 台
          </option>
        ))}
      </Select>
    </label>
  );
}

function FlatNetworkMap({
  nodes,
  onSelect,
  levels,
  effects,
  reduced,
  onToggleEffects,
  touchActive,
  onToggleTouch,
  selectedKey,
  onSelectedChange,
  onViewChange,
}: {
  nodes: MonitorNode[];
  onSelect: (node: MonitorNode) => void;
  selectedKey: string;
  onSelectedChange: (key: string) => void;
  onViewChange: (view: MapView) => void;
} & MapEffectProps) {
  const locations = useMemo(() => groupLocations(nodes), [nodes]);
  const [hoveredKey, setHoveredKey] = useState("");
  const clipId = useId();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<FlatMapPan>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [inView, setInView] = useState(true);
  const mapRef = useRef<HTMLElement>(null);
  const graphicRef = useRef<SVGSVGElement>(null);
  const [mapScale, setMapScale] = useState(1);
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    pan: FlatMapPan;
    zoom: number;
    moved: boolean;
  } | null>(null);
  const suppressMarkerClickRef = useRef(false);
  const current =
    locations.find((item) => item.key === selectedKey) || locations[0];
  const mapped = locations.reduce((sum, item) => sum + item.nodes.length, 0);
  const markerPositions = useMemo(
    () => spreadFlatMapMarkers(locations),
    [locations],
  );
  const distributionRoutes = useMemo(
    () =>
      flatDistributionRoutes(locations, selectedKey, levels, markerPositions),
    [locations, selectedKey, levels, markerPositions],
  );
  const previewLocation = locations.find((item) => item.key === hoveredKey);
  const shown = previewLocation || current;
  const project = projectFlatPoint;
  const selectLocation = (key: string) => {
    if (suppressMarkerClickRef.current) {
      suppressMarkerClickRef.current = false;
      return;
    }
    onSelectedChange(key);
    setHoveredKey("");
    const point = markerPositions.get(key);
    if (point && zoom > 1) {
      setPan(
        clampFlatMapPan(
          { x: (500 - point.x) * zoom, y: (250 - point.y) * zoom },
          zoom,
        ),
      );
    }
  };
  const updateZoom = useCallback(
    (direction: "in" | "out") =>
      setZoom((value) => {
        const next = THREE.MathUtils.clamp(
          value * (direction === "in" ? 1.18 : 0.84),
          1,
          1.72,
        );
        setPan((currentPan) => clampFlatMapPan(currentPan, next));
        return next;
      }),
    [],
  );
  const resetViewport = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  useEffect(() => {
    const map = mapRef.current;
    const graphic = graphicRef.current;
    if (!map || !graphic) return;
    const sizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0)
        setMapScale(Math.min(width / 1000, height / 500));
    });
    sizeObserver.observe(graphic);
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".flat-map-graphic")
      )
        return;
      event.preventDefault();
      updateZoom(event.deltaY < 0 ? "in" : "out");
    };
    map.addEventListener("wheel", handleWheel, { passive: false });
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry.isIntersecting),
    );
    observer.observe(map);
    return () => {
      sizeObserver.disconnect();
      map.removeEventListener("wheel", handleWheel);
      observer.disconnect();
    };
  }, [updateZoom]);

  return (
    <section
      ref={mapRef}
      className="flat-network-map flat-themed network-observatory responsive-map"
      data-touch-active={String(touchActive)}
      data-effects={effects ? "on" : "off"}
      data-in-view={String(inView)}
      aria-label="全球节点地图"
    >
      <div className="flat-map-heading">
        <span>全球节点</span>
        <small>{mapped} 台已标记 · 状态连线示意</small>
      </div>
      <ViewSwitcher view="flat" onChange={onViewChange} />
      <MapLegend nodes={nodes} levels={levels} />
      <MapEffectsToggle
        enabled={effects}
        reduced={reduced}
        onToggle={onToggleEffects}
      />
      {locations.length > 1 && (
        <NodeGroupPicker
          locations={locations}
          value={current?.key || ""}
          onChange={selectLocation}
        />
      )}
      <svg
        ref={graphicRef}
        preserveAspectRatio="xMidYMid meet"
        className={`flat-map-graphic${dragging ? " is-dragging" : ""}`}
        viewBox="0 0 1000 500"
        role="group"
        aria-label="展开的全球节点分布；拖拽可平移，滚轮可缩放，点击节点可查看区域状态"
        onPointerDown={(event) => {
          if (event.pointerType === "touch" && !touchActive) return;
          if (dragRef.current) return;
          if (event.pointerType === "mouse" && event.button !== 0) return;
          if ((event.target as Element).closest(".flat-map-node")) return;
          setHoveredKey("");
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            pan,
            zoom,
            moved: false,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (event.pointerType === "touch" && !touchActive) return;
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const matrix = event.currentTarget.getScreenCTM();
          if (!matrix) return;
          const inverse = matrix.inverse();
          const start = new DOMPoint(
            drag.clientX,
            drag.clientY,
          ).matrixTransform(inverse);
          const point = new DOMPoint(
            event.clientX,
            event.clientY,
          ).matrixTransform(inverse);
          const dx = point.x - start.x;
          const dy = point.y - start.y;
          if (Math.hypot(dx, dy) > 3) {
            drag.moved = true;
            if (drag.zoom === 1) {
              drag.zoom = 1.12;
              setZoom(1.12);
            }
          }
          setPan(
            clampFlatMapPan(
              { x: drag.pan.x + dx, y: drag.pan.y + dy },
              drag.zoom,
            ),
          );
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          if (drag.moved) {
            suppressMarkerClickRef.current = true;
            window.setTimeout(() => {
              suppressMarkerClickRef.current = false;
            }, 0);
          }
          dragRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          setDragging(false);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onLostPointerCapture={() => {
          dragRef.current = null;
          setDragging(false);
        }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="12" y="18" width="976" height="464" rx="14" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect className="flat-map-base" width="1000" height="500" />
          <g className="map-coordinate-labels" aria-hidden="true">
            {[-120, -60, 0, 60, 120].map((lon) => (
              <text key={lon} x={project(0, lon).x} y="470">
                {Math.abs(lon)}°{lon < 0 ? "W" : lon > 0 ? "E" : ""}
              </text>
            ))}
          </g>
          <g
            className="flat-map-world"
            transform={`translate(${500 + pan.x} ${250 + pan.y}) scale(${zoom}) translate(-500 -250)`}
          >
            <g className="flat-map-grid" aria-hidden="true">
              {[-120, -60, 0, 60, 120].map((longitude) => {
                const { x } = project(0, longitude);
                return <line key={longitude} x1={x} y1="0" x2={x} y2="500" />;
              })}
              {[-60, -30, 0, 30, 60].map((latitude) => {
                const { y } = project(latitude, 0);
                return <line key={latitude} x1="0" y1={y} x2="1000" y2={y} />;
              })}
            </g>
            <g className="flat-map-land" aria-hidden="true">
              {flatLandPaths.map((path, index) => (
                <path key={index} d={path} />
              ))}
            </g>
            {distributionRoutes.length > 0 && (
              <g
                className="flat-map-flow"
                aria-label="区域状态连线示意，非实际网络拓扑"
              >
                {distributionRoutes.map((route) => (
                  <g key={route.key} className={`map-route ${route.status}`}>
                    <path className="flat-map-flow-path" d={route.path} />
                    {effects && inView && route.status !== "pending" && (
                      <circle className="flat-map-flow-pulse" r="3">
                        <animateMotion
                          dur={`${route.duration}s`}
                          begin={`${route.delay}s`}
                          repeatCount="indefinite"
                          path={route.path}
                        />
                      </circle>
                    )}
                  </g>
                ))}
              </g>
            )}
            <g className="flat-map-nodes">
              {locations.map((location) => {
                const online = location.nodes.filter(
                  (node) => node.online,
                ).length;
                const status = locationStatus(location, levels);
                const { x, y } =
                  markerPositions.get(location.key) ||
                  project(location.latitude, location.longitude);
                const isSelected = current?.key === location.key;
                return (
                  <g
                    key={location.key}
                    className={`flat-map-node ${status} ${isSelected ? "selected" : ""}`}
                    transform={`translate(${x} ${y}) scale(${1 / (mapScale * zoom)})`}
                    style={
                      {
                        "--echo-delay": `${-(locations.indexOf(location) % 7) * 0.38}s`,
                      } as CSSProperties
                    }
                    onPointerEnter={(event) => {
                      if (event.pointerType !== "touch")
                        setHoveredKey(location.key);
                    }}
                    onPointerLeave={() => setHoveredKey("")}
                    onFocus={() => setHoveredKey(location.key)}
                    onBlur={() => setHoveredKey("")}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`${locationName(location)}，${mapStatusLabels[status]}，在线 ${online} 台，共 ${location.nodes.length} 台节点`}
                    onClick={() => selectLocation(location.key)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectLocation(location.key);
                      }
                    }}
                  >
                    <title>
                      {locationName(location)} · {mapStatusLabels[status]} ·
                      在线 {online}/{location.nodes.length} 台
                    </title>
                    <circle
                      className="flat-map-node-hit-area"
                      r={22}
                      aria-hidden="true"
                    />
                    <circle
                      className="map-node-echo echo-one"
                      r="10"
                      aria-hidden="true"
                    />
                    <circle
                      className="map-node-echo echo-two"
                      r="10"
                      aria-hidden="true"
                    />
                    <circle
                      className="map-node-reticle"
                      r="18"
                      aria-hidden="true"
                    />
                    <circle
                      className="flat-map-node-ring"
                      r={isSelected ? 12 : 9}
                    />
                    <circle
                      className="flat-map-node-dot"
                      r={isSelected ? 5.5 : 4.5}
                    />
                    {(status === "warning" || status === "offline") && (
                      <text
                        className="map-node-alert"
                        x="10"
                        y="-11"
                        aria-hidden="true"
                      >
                        !
                      </text>
                    )}
                    <text
                      className="map-node-label"
                      y="-24"
                      textAnchor="middle"
                      aria-hidden="true"
                    >
                      {locationName(location)}
                    </text>
                  </g>
                );
              })}
            </g>
          </g>
        </g>
        <rect
          className="flat-map-frame"
          x="12"
          y="18"
          width="976"
          height="464"
          rx="14"
        />
      </svg>
      <MapLocationInfo
        location={shown}
        preview={Boolean(
          previewLocation && previewLocation.key !== current?.key,
        )}
        levels={levels}
        onSelect={onSelect}
      />
      <span className="map-interaction-hint">
        拖拽平移 · 滚轮缩放 · 点击定位
      </span>
      <div className="flat-map-controls" role="group" aria-label="地图视图控制">
        <MapTouchToggle active={touchActive} onToggle={onToggleTouch} />
        <button
          type="button"
          className="icon-button"
          aria-label="放大地图"
          title="放大"
          onClick={() => updateZoom("in")}
        >
          <ZoomIn />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="缩小地图"
          title="缩小"
          onClick={() => updateZoom("out")}
        >
          <ZoomOut />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="复位地图"
          title="复位地图"
          onClick={() => {
            onSelectedChange("");
            resetViewport();
          }}
        >
          <RotateCcw />
        </button>
      </div>
    </section>
  );
}

function ThreeGlobe({
  nodes,
  levels,
  effects,
  reduced,
  onToggleEffects,
  touchActive,
  onToggleTouch,
  onSelect,
  dark = false,
  compact = false,
  selectedKey,
  onSelectedChange,
  onViewChange,
}: {
  nodes: MonitorNode[];
  onSelect: (node: MonitorNode) => void;
  dark?: boolean;
  /** Drops the side index so the sphere can stand alone in the dashboard. */
  compact?: boolean;
  selectedKey?: string;
  onSelectedChange?: (key: string) => void;
  onViewChange?: (view: MapView) => void;
} & MapEffectProps) {
  const locations = useMemo(() => groupLocations(nodes), [nodes]);
  const [internalSelected, setInternalSelected] = useState("");
  const selected = selectedKey ?? internalSelected;
  const [rotationState, setRotationState] = useState<RotationState>("rotating");
  const [autoRotate, setAutoRotate] = useState(true);
  const [rotationSpeed, setRotationSpeed] = useState(0.14);
  const [reducedMotion, setReducedMotion] = useState(reduced);
  const [hoveredKey, setHoveredKey] = useState("");
  const hoveredRef = useRef(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const markerRefs = useRef(new Map<string, HTMLButtonElement>());
  const locationsRef = useRef(locations);
  locationsRef.current = locations;
  const touchActiveRef = useRef(touchActive);
  touchActiveRef.current = touchActive;
  const effectsRef = useRef(effects);
  effectsRef.current = effects;
  const levelsRef = useRef(levels);
  levelsRef.current = levels;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;
  const rotationSpeedRef = useRef(rotationSpeed);
  rotationSpeedRef.current = rotationSpeed;
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const controlsRef = useRef<{
    draw: () => void;
    wake: () => void;
    focus: (lat: number, lon: number) => void;
    zoom: (direction: "in" | "out") => void;
    setAutoRotate: (enabled: boolean) => void;
    setAutoRotateSpeed: (speed: number) => void;
    updateDistribution: (
      locations: LocationGroup[],
      selectedKey: string,
    ) => void;
  } | null>(null);
  const current =
    locations.find((item) => item.key === selected) || locations[0];
  const focusedLocation = useRef<string | null>(null);

  useEffect(() => {
    const container = host.current!;
    setLoaded(false);
    setError("");
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      setError("此设备未启用 3D，节点位置列表仍可使用");
      setRotationState("idle");
      return;
    }
    let disposed = false;
    let contextAvailable = true;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-label", "可旋转的全球节点分布");
    // Cloudflare's worker type declarations add a conflicting `prepend` overload;
    // appendChild keeps the browser DOM operation explicit and type-safe here.
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const skyLight = new THREE.HemisphereLight(0xffffff, 0xd6e1e2, 1.9);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
    keyLight.position.set(-3, 3, 5);
    scene.add(skyLight, keyLight);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    let initialDistance = 3.65;
    let minDistance = initialDistance * 0.78;
    let maxDistance = initialDistance * 1.4;
    camera.position.set(0, 0, initialDistance);
    const axialTilt = -THREE.MathUtils.degToRad(23.4);
    const globeFrame = new THREE.Group();
    globeFrame.rotation.set(0.12, 0, axialTilt);
    const earth = new THREE.Group();
    globeFrame.add(earth);
    scene.add(globeFrame);
    const surfaceMaterial = new THREE.MeshPhongMaterial({
      color: dark ? 0x9cbfc5 : 0xffffff,
      specular: dark ? 0x142f35 : 0x446c71,
      shininess: 24,
    });
    surfaceMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        // Preserve terrain detail while matching the dashboard's muted palette.
        float luminance = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        float blueRatio = diffuseColor.b / max(max(diffuseColor.r, diffuseColor.g), 0.001);
        float waterMask = smoothstep(1.15, 1.6, blueRatio);
        vec3 terrain = mix(${dark ? "vec3(0.09, 0.19, 0.21)" : "vec3(0.42, 0.58, 0.56)"}, ${dark ? "vec3(0.22, 0.37, 0.37)" : "vec3(0.76, 0.84, 0.77)"}, sqrt(luminance));
        vec3 water = mix(${dark ? "vec3(0.015, 0.055, 0.075)" : "vec3(0.12, 0.29, 0.33)"}, ${dark ? "vec3(0.035, 0.12, 0.15)" : "vec3(0.24, 0.45, 0.47)"}, smoothstep(0.0, 0.1, luminance));
        diffuseColor.rgb = mix(terrain, water, waterMask);`,
      );
    };
    const surface = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 64),
      surfaceMaterial,
    );
    surface.visible = false;
    earth.add(surface);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: dark ? 0x51bda9 : 0x80c7c4,
      transparent: true,
      opacity: dark ? 0.2 : 0.1,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.025, 64, 48),
      haloMaterial,
    );
    earth.add(halo);
    const geography = buildGlobeGrid(landContours, dark);
    earth.add(geography.group);
    const distributionLayer = buildDistributionLayer(dark);
    earth.add(distributionLayer.group);
    distributionLayer.update(
      locationsRef.current,
      selectedRef.current,
      levelsRef.current,
    );
    renderer.domElement.style.touchAction = "var(--map-touch-action, none)";
    const world = new THREE.Vector3();
    const projected = new THREE.Vector3();
    const cameraDirection = new THREE.Vector3();
    let animationFrame: number | undefined;
    let lastFrameAt: number | undefined;
    let resumeTimer: number | undefined;
    let shouldAutoRotate = false;
    let inViewport = true;
    const draw = () => {
      if (disposed || !contextAvailable) return;
      renderer.render(scene, camera);
      const width = container.clientWidth,
        height = container.clientHeight;
      cameraDirection.copy(camera.position).normalize();
      const markerSize = window.matchMedia("(pointer: coarse)").matches
        ? 44
        : 28;
      const markerInset = markerSize / 2 + 4;
      const occupied: { x: number; y: number }[] = [];
      // Keep the selected region and alarms visible when markers overlap.
      const ordered = [...locationsRef.current].sort((a, b) => {
        const score = (location: (typeof locationsRef.current)[number]) => {
          const status = locationStatus(location, levelsRef.current);
          return (
            (location.key === selectedRef.current ? 1000 : 0) +
            { offline: 300, warning: 200, online: 100, pending: 0 }[status]
          );
        };
        return score(b) - score(a);
      });
      for (const location of ordered) {
        const marker = markerRefs.current.get(location.key);
        if (!marker) continue;
        world.set(
          ...globePosition(location.latitude, location.longitude, 1.015),
        );
        earth.localToWorld(world);
        // Perspective horizon: hide markers as their surface turns away.
        const front = world.dot(cameraDirection) > 1 / camera.position.length();
        projected.copy(world).project(camera);
        const x = ((projected.x + 1) / 2) * width,
          y = ((1 - projected.y) / 2) * height;
        const overlap = occupied.some(
          (p) =>
            Math.abs(p.x - x) < markerSize && Math.abs(p.y - y) < markerSize,
        );
        const visible =
          front &&
          !overlap &&
          x > markerInset &&
          x < width - markerInset &&
          y > markerInset &&
          y < height - markerInset;
        if (visible) occupied.push({ x, y });
        marker.style.visibility = visible ? "visible" : "hidden";
        marker.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      }
    };
    const stopScheduledRotation = () => {
      if (resumeTimer !== undefined) {
        window.clearTimeout(resumeTimer);
        resumeTimer = undefined;
      }
    };
    const animate = (timestamp: number) => {
      animationFrame = undefined;
      if (
        disposed ||
        !contextAvailable ||
        document.hidden ||
        !inViewport ||
        reducedMotionRef.current ||
        (!shouldAutoRotate && !effectsRef.current)
      )
        return;
      const elapsed = Math.min(
        (timestamp - (lastFrameAt ?? timestamp)) / 1000,
        0.08,
      );
      lastFrameAt = timestamp;
      if (shouldAutoRotate && !hoveredRef.current)
        earth.rotateY(rotationSpeedRef.current * elapsed);
      if (effectsRef.current) distributionLayer.tick(timestamp / 1000);
      draw();
      animationFrame = requestAnimationFrame(animate);
    };
    const startAutoRotation = () => {
      if (animationFrame === undefined) {
        lastFrameAt = undefined;
        animationFrame = requestAnimationFrame(animate);
      }
    };
    const setAutoRotation = (enabled: boolean) => {
      const shouldRotate = enabled && !reducedMotionRef.current;
      stopScheduledRotation();
      shouldAutoRotate = shouldRotate;
      setRotationState(shouldRotate ? "rotating" : "idle");
      if (shouldRotate || effectsRef.current) startAutoRotation();
      draw();
    };
    const pauseThenResume = (delay = 2400) => {
      stopScheduledRotation();
      shouldAutoRotate = false;
      if (!autoRotateRef.current || reducedMotionRef.current) {
        setRotationState("idle");
        draw();
        return;
      }
      setRotationState("idle");
      draw();
      resumeTimer = window.setTimeout(() => {
        if (disposed || !autoRotateRef.current || reducedMotionRef.current)
          return;
        shouldAutoRotate = true;
        setRotationState("rotating");
        startAutoRotation();
      }, delay);
    };
    const focus = (latitude: number, lon: number) => {
      camera.position.set(0, 0, initialDistance);
      globeFrame.rotation.set(
        THREE.MathUtils.degToRad(latitude),
        0,
        axialTilt,
        "ZXY",
      );
      // Align both coordinates before applying the display's axial tilt.
      earth.rotation.set(0, -Math.PI / 2 - THREE.MathUtils.degToRad(lon), 0);
      pauseThenResume(3600);
    };
    const zoom = (direction: "in" | "out") => {
      const currentDistance = camera.position.length();
      const scale = direction === "in" ? 0.82 : 1.18;
      const nextDistance = THREE.MathUtils.clamp(
        currentDistance * scale,
        minDistance,
        maxDistance,
      );
      camera.position.setLength(nextDistance);
      pauseThenResume();
    };
    controlsRef.current = {
      draw,
      wake: startAutoRotation,
      focus,
      zoom,
      setAutoRotate: setAutoRotation,
      setAutoRotateSpeed: (speed: number) => {
        rotationSpeedRef.current = speed;
      },
      updateDistribution: (
        nextLocations: LocationGroup[],
        nextSelectedKey: string,
      ) => {
        distributionLayer.update(
          nextLocations,
          nextSelectedKey,
          levelsRef.current,
        );
      },
    };
    const resize = () => {
      const width = container.clientWidth,
        height = container.clientHeight;
      if (!width || !height) return;
      const zoomRatio = camera.position.length() / initialDistance;
      camera.aspect = width / height;
      const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const horizontalHalfFov = Math.atan(
        Math.tan(verticalHalfFov) * camera.aspect,
      );
      // Fit the globe and raised routes along the narrower field of view.
      initialDistance =
        1.22 / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov));
      minDistance = initialDistance * 0.78;
      maxDistance = initialDistance * 1.4;
      camera.position.setLength(
        THREE.MathUtils.clamp(
          initialDistance * zoomRatio,
          minDistance,
          maxDistance,
        ),
      );
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(
        Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(2_000_000 / (width * height)),
        ),
      );
      renderer.setSize(width, height, false);
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    window.addEventListener("resize", resize);
    resize();
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      inViewport = entry.isIntersecting;
      container
        .closest(".network-observatory")
        ?.setAttribute("data-in-view", String(inViewport));
      if (inViewport) startAutoRotation();
    });
    visibilityObserver.observe(container);
    const onVisibility = () => {
      if (!document.hidden) startAutoRotation();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const pointers = new Map<number, { x: number; y: number }>();
    const pointerDistance = () => {
      const [first, second] = [...pointers.values()];
      return Math.hypot(first.x - second.x, first.y - second.y);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch" && !touchActiveRef.current) return;
      if (event.button !== 0) return;
      renderer.domElement.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      stopScheduledRotation();
      shouldAutoRotate = false;
      setRotationState("interacting");
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" && !touchActiveRef.current) {
        pointers.clear();
        return;
      }
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const previousDistance = pointers.size === 2 ? pointerDistance() : 0;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        const scale = Math.PI / Math.max(container.clientHeight, 1);
        // Turn the model beneath a fixed camera and light, like a desk globe.
        earth.rotation.y += (event.clientX - previous.x) * scale;
        globeFrame.rotation.x = THREE.MathUtils.clamp(
          globeFrame.rotation.x + (event.clientY - previous.y) * scale,
          -Math.PI / 3,
          Math.PI / 3,
        );
      } else if (pointers.size === 2) {
        const distance = pointerDistance();
        if (distance > 0 && previousDistance > 0) {
          camera.position.setLength(
            THREE.MathUtils.clamp(
              (camera.position.length() * previousDistance) / distance,
              minDistance,
              maxDistance,
            ),
          );
        }
      }
      draw();
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;
      if (!pointers.size) pauseThenResume(1200);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      zoom(event.deltaY < 0 ? "in" : "out");
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerEnd);
    renderer.domElement.addEventListener("pointercancel", onPointerEnd);
    renderer.domElement.addEventListener("lostpointercapture", onPointerEnd);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotionPreference = (matches: boolean) => {
      reducedMotionRef.current = matches;
      setReducedMotion(matches);
      if (matches) {
        autoRotateRef.current = false;
        setAutoRotate(false);
        setAutoRotation(false);
      }
    };
    const onMotionPreferenceChange = (event: MediaQueryListEvent) =>
      syncMotionPreference(event.matches);
    syncMotionPreference(motionQuery.matches);
    motionQuery.addEventListener("change", onMotionPreferenceChange);
    if (autoRotateRef.current && !motionQuery.matches) setAutoRotation(true);
    draw();
    // The component can mount before the first node response arrives. Keep
    // the selected region centred when data is already available, while the
    // locations effect below handles the late-arriving first point.
    if (current) {
      focusedLocation.current = current.key;
      focus(current.latitude, current.longitude);
    } else {
      focus(25, 100);
    }
    // Initial orientation should start spinning immediately, without a focus pause.
    if (autoRotateRef.current && !motionQuery.matches) setAutoRotation(true);
    const surfaceTexture = new THREE.TextureLoader().load(
      earthTextureUrl,
      () => {
        if (disposed) return;
        surface.visible = true;
        setLoaded(true);
        draw();
      },
      undefined,
      () => {
        if (disposed) return;
        setError("地表纹理加载失败，请刷新重试");
        setAutoRotation(false);
      },
    );
    surfaceTexture.colorSpace = THREE.SRGBColorSpace;
    surfaceTexture.anisotropy = Math.min(
      renderer.capabilities.getMaxAnisotropy(),
      8,
    );
    surfaceMaterial.map = surfaceTexture;
    surfaceMaterial.needsUpdate = true;
    const contextLost = (event: Event) => {
      event.preventDefault();
      contextAvailable = false;
      shouldAutoRotate = false;
      stopScheduledRotation();
      setError("3D 渲染已暂停，刷新页面可重试");
      setRotationState("idle");
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    return () => {
      disposed = true;
      controlsRef.current = null;
      stopScheduledRotation();
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      visibilityObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motionQuery.removeEventListener("change", onMotionPreferenceChange);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerEnd);
      renderer.domElement.removeEventListener("pointercancel", onPointerEnd);
      renderer.domElement.removeEventListener(
        "lostpointercapture",
        onPointerEnd,
      );
      renderer.domElement.removeEventListener("wheel", onWheel);
      distributionLayer.dispose();
      geography.dispose();
      halo.geometry.dispose();
      haloMaterial.dispose();
      surface.geometry.dispose();
      surfaceMaterial.dispose();
      surfaceTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [dark]);
  useEffect(() => {
    controlsRef.current?.updateDistribution(locations, selected);
    const point = current || locations[0];
    if (!point) {
      controlsRef.current?.draw();
      return;
    }
    const focused = focusedLocation.current;
    if (!focused || !locations.some((location) => location.key === focused)) {
      focusedLocation.current = point.key;
      controlsRef.current?.focus(point.latitude, point.longitude);
    } else {
      controlsRef.current?.draw();
    }
  }, [locations, selected, levels]);
  useEffect(() => {
    controlsRef.current?.wake();
  }, [effects]);
  const visualRotationState = error ? "error" : rotationState;
  const rotationClass =
    visualRotationState === "interacting"
      ? "is-interacting"
      : visualRotationState === "rotating"
        ? "is-rotating"
        : "is-idle";
  const selectLocation = (key: string) => {
    if (selectedKey === undefined) setInternalSelected(key);
    onSelectedChange?.(key);
    setRotationState("idle");
    controlsRef.current?.updateDistribution(locations, key);
    const point = locations.find((item) => item.key === key);
    if (point) {
      focusedLocation.current = point.key;
      controlsRef.current?.focus(point.latitude, point.longitude);
    }
  };
  const toggleAutoRotation = () => {
    if (reducedMotion) return;
    const enabled = !autoRotate;
    autoRotateRef.current = enabled;
    setAutoRotate(enabled);
    controlsRef.current?.setAutoRotate(enabled);
  };
  const cycleAutoRotationSpeed = () => {
    const currentIndex = rotationSpeedPresets.findIndex(
      (preset) => preset.value === rotationSpeed,
    );
    const next =
      rotationSpeedPresets[(currentIndex + 1) % rotationSpeedPresets.length];
    rotationSpeedRef.current = next.value;
    setRotationSpeed(next.value);
    controlsRef.current?.setAutoRotateSpeed(next.value);
  };
  const rotationSpeedLabel =
    rotationSpeedPresets.find((preset) => preset.value === rotationSpeed)
      ?.label || "标准";
  const mapped = locations.reduce((sum, item) => sum + item.nodes.length, 0);
  const onlineCount = nodes.filter((node) => node.online).length;
  const offlineCount = nodes.filter(
    (node) => !node.online && node.lastSeen,
  ).length;
  return (
    <section
      className={`geo-overview ${rotationClass}`}
      aria-label="全球节点分布"
      data-rotation-state={visualRotationState}
    >
      {!compact && (
        <div className="geo-index">
          <div className="geo-heading">
            <Globe2 size={17} />
            <span className="geo-kicker">GLOBAL NETWORK</span>
          </div>
          <h2 className="geo-title">节点遍布全球</h2>
          <p className="geo-subtitle">实时查看公开节点的运行状态和区域分布</p>
          <div
            className="geo-status-float"
            aria-label={`在线 ${onlineCount} 台，离线 ${offlineCount} 台`}
          >
            <span>
              <i className="state-dot online" />
              {onlineCount} 在线
            </span>
            <span>
              <i className="state-dot offline" />
              {offlineCount} 离线
            </span>
          </div>
          <p className="geo-count">
            <strong>{mapped}</strong> 台已标记{" "}
            <span>
              {nodes.length - mapped > 0
                ? `${nodes.length - mapped} 台位置未知`
                : "当前可见节点"}
            </span>
          </p>
          <label className="geo-picker">
            <span>快速定位</span>
            <Select
              value={current?.key || "__empty"}
              onChange={(e) =>
                e.target.value !== "__empty" && selectLocation(e.target.value)
              }
              aria-label="选择节点位置"
            >
              {!locations.length && (
                <option value="__empty">暂无位置数据</option>
              )}
              {locations.map((point, index) => (
                <option key={point.key} value={point.key}>
                  {locationName(point)} · {point.nodes.length} 台
                  {point.approximate ? " · 地区参考点" : " · 手动坐标"}
                </option>
              ))}
            </Select>
          </label>
          {current && (
            <div className="geo-nodes">
              <div className="geo-precision">
                <MapPin size={12} />
                {current.approximate ? "地区级近似位置" : "管理员指定坐标"}
                <span>
                  {current.latitude.toFixed(2)}, {current.longitude.toFixed(2)}
                </span>
              </div>
              <div className="geo-node-list">
                {current.nodes.map((node) => (
                  <button key={node.id} onClick={() => onSelect(node)}>
                    <i
                      className={`state-dot ${node.online ? "online" : node.lastSeen ? "offline" : "pending"}`}
                    />
                    <span>{node.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div
        className={`globe-surface network-observatory ${compact ? "globe-themed responsive-map" : ""} ${rotationClass}`}
        data-touch-active={String(touchActive)}
        data-effects={effects ? "on" : "off"}
        data-rotation-state={visualRotationState}
      >
        {compact && (
          <>
            <div className="globe-network-heading">
              <span>全球节点</span>
              <small>{mapped} 台已标记 · 状态连线示意</small>
            </div>
            {onViewChange && (
              <ViewSwitcher view="globe" onChange={onViewChange} />
            )}
          </>
        )}
        <MapLegend nodes={nodes} levels={levels} />
        <MapEffectsToggle
          enabled={effects}
          reduced={reduced}
          onToggle={onToggleEffects}
        />
        {compact && locations.length > 1 && (
          <NodeGroupPicker
            locations={locations}
            value={current?.key || ""}
            onChange={selectLocation}
          />
        )}
        <div
          className="globe-canvas"
          ref={host}
          data-loaded={loaded}
          data-rotation-state={visualRotationState}
        >
          <div className="globe-orbit-guide" aria-hidden="true" />
          {!error &&
            locations.map((location) => {
              const online = location.nodes.filter(
                (node) => node.online,
              ).length;
              const total = location.nodes.length;
              const status = locationStatus(location, levels);
              return (
                <button
                  key={location.key}
                  className={`globe-marker ${location.key === current?.key ? "selected" : ""} ${status}`}
                  ref={(element) => {
                    if (element) markerRefs.current.set(location.key, element);
                    else markerRefs.current.delete(location.key);
                  }}
                  onPointerEnter={(event) => {
                    if (event.pointerType !== "touch") {
                      hoveredRef.current = true;
                      setHoveredKey(location.key);
                    }
                  }}
                  onPointerLeave={() => {
                    hoveredRef.current = false;
                    setHoveredKey("");
                  }}
                  onFocus={() => {
                    hoveredRef.current = true;
                    setHoveredKey(location.key);
                  }}
                  onBlur={() => {
                    hoveredRef.current = false;
                    setHoveredKey("");
                  }}
                  onClick={() => selectLocation(location.key)}
                  style={
                    {
                      "--echo-delay": `${-(locations.indexOf(location) % 7) * 0.38}s`,
                    } as CSSProperties
                  }
                  title={`${locationName(location)} · ${mapStatusLabels[status]} · 在线 ${online}/${total} 台`}
                  aria-pressed={location.key === current?.key}
                  aria-label={`${locationName(location)}，${mapStatusLabels[status]}，在线 ${online} 台，共 ${total} 台节点`}
                >
                  <span className="map-node-echo echo-one" aria-hidden="true" />
                  <span className="map-node-echo echo-two" aria-hidden="true" />
                  <span className="map-node-reticle" aria-hidden="true" />
                  <i aria-hidden="true" />
                  {(status === "warning" || status === "offline") && (
                    <span className="map-node-alert" aria-hidden="true">
                      !
                    </span>
                  )}
                  <span className="map-node-label" aria-hidden="true">
                    {locationName(location)}
                  </span>
                </button>
              );
            })}
          {(!loaded || error) && (
            <div className="globe-message" role="status">
              {error || "加载全球节点"}
            </div>
          )}
        </div>
        {compact && (
          <MapLocationInfo
            location={
              locations.find((item) => item.key === hoveredKey) || current
            }
            preview={Boolean(hoveredKey && hoveredKey !== current?.key)}
            levels={levels}
            onSelect={onSelect}
          />
        )}
        <div
          className={`globe-controls ${rotationClass}`}
          role="group"
          aria-label="地球视图控制"
          data-rotation-state={visualRotationState}
        >
          <MapTouchToggle active={touchActive} onToggle={onToggleTouch} />
          <span>
            <i className="state-dot online" />
            在线
            <i className="state-dot offline" />
            离线
            <i className="state-dot pending" />
            待接入
          </span>
          <button
            type="button"
            className={`icon-button ${autoRotate ? "active" : ""}`}
            aria-label={autoRotate ? "暂停自动旋转" : "开始自动旋转"}
            aria-pressed={autoRotate}
            title={autoRotate ? "暂停自动旋转" : "开始自动旋转"}
            disabled={Boolean(error) || reducedMotion}
            onClick={toggleAutoRotation}
          >
            {autoRotate ? <Pause /> : <Play />}
          </button>
          <button
            type="button"
            className="icon-button rotation-speed"
            aria-label={`自动旋转速度：${rotationSpeedLabel}；点击切换`}
            title={`自动旋转速度：${rotationSpeedLabel}；点击切换`}
            disabled={Boolean(error) || reducedMotion}
            onClick={cycleAutoRotationSpeed}
          >
            {rotationSpeedLabel}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="放大地球"
            title="放大"
            disabled={Boolean(error)}
            onClick={() => {
              setRotationState("idle");
              controlsRef.current?.zoom("in");
            }}
          >
            <ZoomIn />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="缩小地球"
            title="缩小"
            disabled={Boolean(error)}
            onClick={() => {
              setRotationState("idle");
              controlsRef.current?.zoom("out");
            }}
          >
            <ZoomOut />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="复位地球"
            title="复位地球"
            onClick={() => {
              setRotationState("idle");
              if (current) {
                focusedLocation.current = current.key;
                controlsRef.current?.focus(current.latitude, current.longitude);
              } else {
                controlsRef.current?.focus(25, 100);
              }
            }}
          >
            <RotateCcw />
          </button>
        </div>
      </div>
    </section>
  );
}

const emptyLevels: NodeLevels = new Map();

export default function Globe({
  nodes,
  levels = emptyLevels,
  onSelect,
  dark = false,
  compact = false,
}: {
  nodes: MonitorNode[];
  levels?: NodeLevels;
  onSelect: (node: MonitorNode) => void;
  dark?: boolean;
  compact?: boolean;
}) {
  const [compactView, setCompactView] = useState<MapView>("flat");
  const reduced = useMapMotion();
  const [effectsEnabled, setEffectsEnabled] = useState(true);
  const [touchActive, setTouchActive] = useState(false);
  const effectProps = {
    levels,
    effects: effectsEnabled && !reduced,
    reduced,
    onToggleEffects: () => setEffectsEnabled((value) => !value),
    touchActive,
    onToggleTouch: () => setTouchActive((value) => !value),
  };
  const [selectedKey, setSelectedKey] = useState("");
  if (compact) {
    if (compactView === "flat") {
      return (
        <FlatNetworkMap
          {...effectProps}
          onSelect={onSelect}
          nodes={nodes}
          selectedKey={selectedKey}
          onSelectedChange={setSelectedKey}
          onViewChange={setCompactView}
        />
      );
    }
    return (
      <ThreeGlobe
        {...effectProps}
        nodes={nodes}
        onSelect={onSelect}
        dark={dark}
        compact
        selectedKey={selectedKey}
        onSelectedChange={setSelectedKey}
        onViewChange={setCompactView}
      />
    );
  }
  return (
    <ThreeGlobe
      {...effectProps}
      nodes={nodes}
      onSelect={onSelect}
      dark={dark}
    />
  );
}
