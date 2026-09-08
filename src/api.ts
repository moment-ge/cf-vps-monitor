export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
    headers:
      data === undefined ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new ApiError(response.status, result.error || "请求失败");
  return result as T;
}
export const bytes = (value: number, decimals = 1) => {
  if (!Number.isFinite(value) || value < 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(Math.max(1, value)) / Math.log(1024)),
  );
  return `${(value / 1024 ** index).toFixed(index ? decimals : 0)} ${units[index]}`;
};
export const percentage = (used: number, total: number) =>
  total > 0 ? Math.min(100, (used / total) * 100) : 0;
export const dateTime = (seconds: number) =>
  seconds
    ? new Date(seconds * 1000).toLocaleString("zh-CN", { hour12: false })
    : "尚未上报";
export const daysLeft = (date: string | null) =>
  date
    ? Math.ceil((Date.parse(`${date}T23:59:59Z`) - Date.now()) / 86400000)
    : null;
export const uptime = (seconds: number) =>
  seconds >= 86400
    ? `${Math.floor(seconds / 86400)} 天`
    : `${Math.floor(seconds / 3600)} 小时`;
export function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
