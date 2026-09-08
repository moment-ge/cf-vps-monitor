import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { HistoryPoint } from "../shared/types";
import { bytes, percentage } from "./api";

export default function Chart({
  points,
  mode,
  dark,
}: {
  points: HistoryPoint[];
  mode: "load" | "network";
  dark: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || points.length === 0) return;
    const load = mode === "load";
    const data: uPlot.AlignedData = load
      ? [
          points.map((p) => p.ts),
          points.map((p) => p.metrics.cpu),
          points.map((p) =>
            percentage(p.metrics.memoryUsed, p.metrics.memoryTotal),
          ),
          points.map((p) =>
            percentage(p.metrics.diskUsed, p.metrics.diskTotal),
          ),
        ]
      : [
          points.map((p) => p.ts),
          points.map((p) => p.metrics.uploadRate),
          points.map((p) => p.metrics.downloadRate),
        ];
    const colors = ["#16a085", "#4d83e0", "#c88728"];
    const chart = new uPlot(
      {
        width: ref.current.clientWidth || 400,
        height: 240,
        cursor: { drag: { x: false, y: false } },
        scales: {
          x: { time: true },
          y: load ? { range: [0, 100] } : { auto: true },
        },
        axes: [
          {
            stroke: dark ? "#94a6b0" : "#73818c",
            grid: { show: false },
            ticks: { show: false },
            font: "11px system-ui",
          },
          {
            stroke: dark ? "#94a6b0" : "#73818c",
            grid: { stroke: dark ? "#2c343b" : "#e9eef1" },
            ticks: { show: false },
            size: load ? 40 : 70,
            font: "11px system-ui",
            values: (_u, values) =>
              values.map((v) => (load ? `${v}%` : bytes(v))),
          },
        ],
        series: [
          { label: "时间" },
          ...(load ? ["CPU", "内存", "磁盘"] : ["上传", "下载"]).map(
            (label, i) => ({
              label,
              stroke: colors[i],
              width: 2,
              points: { show: false },
              spanGaps: false,
              value: (_u: uPlot, value: number | null) =>
                value === null
                  ? "-"
                  : load
                    ? `${value.toFixed(1)}%`
                    : `${bytes(value)}/s`,
            }),
          ),
        ],
      },
      data,
      ref.current,
    );
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) chart.setSize({ width, height: 240 });
    });
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.destroy();
    };
  }, [points, mode, dark]);
  return (
    <div
      className="chart"
      ref={ref}
      aria-label={
        mode === "load" ? "CPU 内存和磁盘历史曲线" : "上传和下载速率历史曲线"
      }
    />
  );
}
