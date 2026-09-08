import type { MonitorNode } from "./types";

export function nodeIsOnline(
  node: Pick<MonitorNode, "archived" | "lastSeen">,
  now: number,
  offlineAfter: number,
) {
  return (
    !node.archived && node.lastSeen > 0 && now - node.lastSeen <= offlineAfter
  );
}

export function sampleAge(lastSeen: number, now: number) {
  if (!lastSeen) return "尚未上报";
  const seconds = Math.max(0, Math.floor(now - lastSeen));
  if (seconds < 60) return "刚刚上报";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

export function probeEndpoint(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["", "/"].includes(url.pathname)
    )
      return null;
    if (
      ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(url.hostname) ||
      url.hostname.endsWith(".localhost")
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
