import { useEffect, useRef } from "react";
import { Activity, ArrowUpRight, ChevronLeft, ShieldCheck } from "lucide-react";
import type { PublicNode } from "../shared/types";
import { isLocalNavigation, nodeDetailHref } from "./node-route";
import "./public-status.css";

const labels: Record<PublicNode["status"], string> = {
  online: "运行正常",
  warning: "运行异常",
  offline: "已离线",
  pending: "待接入",
};

export default function PublicStatus({
  nodes,
  nodeId,
  loading,
  error,
  onOpen,
  onBack,
  onRetry,
  onLogin,
}: {
  nodes: PublicNode[];
  nodeId: string | null;
  loading: boolean;
  error: string;
  onOpen: (id: string) => void;
  onBack: () => void;
  onRetry: () => void;
  onLogin: () => void;
}) {
  const selected = nodes.find((node) => node.id === nodeId);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (nodeId) heading.current?.focus({ preventScroll: true });
  }, [nodeId, selected?.id, loading]);
  return (
    <section className="public-status" aria-busy={loading}>
      {nodeId && (
        <button className="node-detail-back" onClick={onBack}>
          <ChevronLeft size={16} />
          返回状态列表
        </button>
      )}
      <header className="public-status-heading">
        <div>
          <div className="eyebrow">SERVICE STATUS</div>
          <h1 ref={heading} tabIndex={-1}>
            {nodeId ? selected?.name || "节点状态" : "运行状态"}
          </h1>
          <p>公开展示服务可用性，节点身份信息受保护。</p>
        </div>
        <span className="public-privacy-label">
          <ShieldCheck size={17} />
          匿名状态
        </span>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={onRetry}>重试</button>
          <button onClick={onLogin}>管理员登录</button>
        </div>
      )}
      {loading && nodes.length === 0 ? (
        <div className="loading" role="status">
          正在获取运行状态…
        </div>
      ) : nodeId ? (
        selected ? (
          <article className="public-node-detail" data-status={selected.status}>
            <span className="public-signal">
              <Activity size={30} />
            </span>
            <h2>{labels[selected.status]}</h2>
            <p>此页面仅提供当前运行状态。</p>
            <span className="public-node-alias">{selected.name}</span>
          </article>
        ) : (
          <div className="empty">
            <h2>节点不存在或不可访问</h2>
            <p>返回列表查看可用的公开节点。</p>
          </div>
        )
      ) : (
        <>
          <div className="public-status-counts">
            {(Object.keys(labels) as PublicNode["status"][]).map((status) => (
              <div key={status} data-status={status}>
                <span>
                  <i className="public-status-dot" />
                  {labels[status]}
                </span>
                <strong>
                  {nodes.filter((node) => node.status === status).length}
                </strong>
              </div>
            ))}
          </div>
          <div className="public-node-grid">
            {nodes.map((node) => (
              <a
                key={node.id}
                className="public-node-card"
                data-status={node.status}
                href={nodeDetailHref(node.id)}
                onClick={(event) => {
                  if (isLocalNavigation(event)) {
                    event.preventDefault();
                    onOpen(node.id);
                  }
                }}
              >
                <span className="public-signal">
                  <Activity size={22} />
                </span>
                <div>
                  <h2>{node.name}</h2>
                  <span className="public-node-state">
                    <i className="public-status-dot" />
                    {labels[node.status]}
                  </span>
                </div>
                <ArrowUpRight
                  className="public-card-arrow"
                  size={19}
                  aria-hidden="true"
                />
              </a>
            ))}
          </div>
          {!nodes.length && !error && (
            <div className="empty">
              <h2>暂无公开节点</h2>
              <p>节点开放匿名状态后会显示在这里。</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
