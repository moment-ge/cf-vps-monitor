import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";

export const nodeDetailHref = (id: string) =>
  `/nodes/${encodeURIComponent(id)}`;

export function nodeIdFromPath(path: string) {
  const match = /^\/nodes\/([^/]+)\/?$/.exec(path);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function isLocalNavigation(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.defaultPrevented
  );
}

export function useNodeRoute() {
  const [nodeId, setNodeId] = useState(() =>
    nodeIdFromPath(window.location.pathname),
  );
  const returnPosition = useRef(0);
  useEffect(() => {
    let frame = 0;
    const sync = () => {
      const next = nodeIdFromPath(window.location.pathname);
      setNodeId(next);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        window.scrollTo({
          top: next ? 0 : returnPosition.current,
          behavior: "instant",
        }),
      );
    };
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      cancelAnimationFrame(frame);
    };
  }, []);
  const openNode = useCallback((id: string) => {
    if (nodeIdFromPath(window.location.pathname) === id) return;
    returnPosition.current = window.scrollY;
    window.history.pushState(
      { monitorNodeEntry: true },
      "",
      nodeDetailHref(id),
    );
    setNodeId(id);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  const closeNode = () => {
    if (window.history.state?.monitorNodeEntry) window.history.back();
    else {
      window.history.replaceState(null, "", "/");
      setNodeId(null);
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  };
  const clearNode = () => {
    if (!nodeId) return;
    window.history.pushState(null, "", "/");
    setNodeId(null);
  };
  return { nodeId, openNode, closeNode, clearNode };
}
