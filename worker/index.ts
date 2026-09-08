import {
  defaults,
  effectiveSettings,
  type Settings,
  type MonitorNode,
  type Metrics,
  type RecentSample,
  type PublicNode,
} from "../shared/types";
import {
  HttpError,
  object,
  validateMetrics,
  validateNode,
  validateSettings,
} from "./validation";
import { nodeIsOnline } from "../shared/node-state";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}
interface Row {
  id: string;
  token_hash: string;
  name: string;
  region: string;
  group_name: string;
  visible: number;
  sort_order: number;
  price: number;
  currency: string;
  billing_cycle: string;
  expires_at: string | null;
  notes: string;
  latitude: number | null;
  longitude: number | null;
  location: string;
  traffic_limit: number;
  archived: number;
  created_at: number;
  last_seen: number;
  metrics: string | null;
  alert_state: string;
}
const encoder = new TextEncoder();
const nowSeconds = () => Math.floor(Date.now() / 1000);
/** Samples per node returned with the fleet list, for the card strips. */
const RECENT_SAMPLES = 16;
const json = (
  value: unknown,
  status = 200,
  extra: Record<string, string> = {},
) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Strict-Transport-Security": "max-age=31536000",
      Vary: "Cookie",
      ...extra,
    },
  });
async function sha(value: string): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function signature(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}
function requireSecrets(env: Env) {
  if (
    !env.ADMIN_PASSWORD ||
    env.ADMIN_PASSWORD.length < 10 ||
    !env.SESSION_SECRET ||
    env.SESSION_SECRET.length < 32
  )
    throw new HttpError(503, "管理员凭据尚未配置，请按部署文档设置 Secrets");
}
async function isAdmin(request: Request, env: Env): Promise<boolean> {
  if (
    !env.SESSION_SECRET ||
    env.SESSION_SECRET.length < 32 ||
    !env.ADMIN_PASSWORD ||
    env.ADMIN_PASSWORD.length < 10
  )
    return false;
  const value = request.headers
    .get("Cookie")
    ?.match(/(?:^|;\s*)monitor_session=([^;]+)/)?.[1];
  if (!value || value.length > 256) return false;
  const [exp, nonce, sig, extra] = value.split(".");
  if (
    extra ||
    !/^\d{10}$/.test(exp) ||
    !/^[a-f\d-]{36}$/.test(nonce || "") ||
    !/^[a-f\d]{64}$/.test(sig || "")
  )
    return false;
  if (Number(exp) <= nowSeconds() || Number(exp) > nowSeconds() + 43200)
    return false;
  return safeEqual(sig, await signature(`${exp}.${nonce}`, env.SESSION_SECRET));
}
function cookie(request: Request, value: string, maxAge: number) {
  return `monitor_session=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new HttpError(415, "需要 application/json");
  if (Number(request.headers.get("Content-Length") || 0) > 16384)
    throw new HttpError(413, "请求过大");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "请求内容为空");
  let total = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 16384) {
      await reader.cancel();
      throw new HttpError(413, "请求过大");
    }
    parts.push(value);
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.length;
  }
  try {
    return object(JSON.parse(new TextDecoder().decode(buffer)));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "JSON 格式无效");
  }
}
async function settings(env: Env) {
  const row = await env.DB.prepare(
    "SELECT value FROM settings WHERE id = 1",
  ).first<{ value: string }>();
  const { _activeNodes = 0, ...raw } = JSON.parse(row?.value || "{}");
  const configured: Settings = { ...defaults, ...raw };
  return {
    configured,
    effective: effectiveSettings(configured, Number(_activeNodes)),
  };
}
function fleetCountStatement(env: Env) {
  return env.DB.prepare(
    "UPDATE settings SET value = json_set(value, '$._activeNodes', (SELECT COUNT(*) FROM nodes WHERE archived = 0)) WHERE id = 1",
  );
}
function serializeAdminNode(row: Row, config: Settings): MonitorNode {
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    group: row.group_name,
    visible: Boolean(row.visible),
    sortOrder: row.sort_order,
    price: row.price,
    currency: row.currency,
    billingCycle: row.billing_cycle,
    expiresAt: row.expires_at,
    notes: row.notes,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    location: row.location || "",
    trafficLimit: row.traffic_limit ?? 0,
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    lastSeen: row.last_seen,
    online: nodeIsOnline(
      { archived: Boolean(row.archived), lastSeen: row.last_seen },
      nowSeconds(),
      config.offlineAfter,
    ),
    metrics: row.metrics ? JSON.parse(row.metrics) : null,
  };
}
async function publicFleetNodes(
  rows: Row[],
  config: Settings,
  env: Env,
): Promise<PublicNode[]> {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
    throw new HttpError(503, "公开状态页尚未配置完成");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = nowSeconds();
  return Promise.all(
    rows.map(async (row) => {
      const alias = hex(
        await crypto.subtle.sign(
          "HMAC",
          key,
          encoder.encode(`public-node:v1:${row.id}`),
        ),
      ).slice(0, 32);
      const online = nodeIsOnline(
        { archived: Boolean(row.archived), lastSeen: row.last_seen },
        now,
        config.offlineAfter,
      );
      const status: PublicNode["status"] = !row.last_seen
        ? "pending"
        : !online
          ? "offline"
          : nodeAlerts(row, config, now).length
            ? "warning"
            : "online";
      return {
        id: `public-${alias}`,
        name: `节点 ${alias.slice(0, 8).toUpperCase()}`,
        status,
      };
    }),
  );
}
async function getNode(env: Env, id: string) {
  const row = await env.DB.prepare("SELECT * FROM nodes WHERE id = ?")
    .bind(id)
    .first<Row>();
  if (!row) throw new HttpError(404, "节点不存在");
  return row;
}
async function login(request: Request, env: Env) {
  requireSecrets(env);
  const data = await body(request);
  if (typeof data.password !== "string" || data.password.length > 512)
    throw new HttpError(400, "登录凭据无效");
  const now = nowSeconds();
  const key = await sha(
    `${request.headers.get("CF-Connecting-IP") || "local"}:${Math.floor(now / 900)}`,
  );
  // One atomic increment prevents concurrent login attempts from bypassing the limit.
  const limit = await env.DB.prepare(
    "INSERT INTO login_limits (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1 RETURNING attempts",
  )
    .bind(key, now + 900)
    .first<{ attempts: number }>();
  if (limit && limit.attempts > 10)
    throw new HttpError(429, "登录尝试过多，请 15 分钟后重试");
  if (!safeEqual(await sha(data.password), await sha(env.ADMIN_PASSWORD!)))
    throw new HttpError(401, "管理员密码不正确");
  const payload = `${now + 43200}.${crypto.randomUUID()}`;
  const value = `${payload}.${await signature(payload, env.SESSION_SECRET!)}`;
  return json({ ok: true }, 200, {
    "Set-Cookie": cookie(request, value, 43200),
  });
}
async function ingest(request: Request, env: Env) {
  const token = request.headers
    .get("Authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1];
  if (!token) throw new HttpError(401, "探针密钥无效");
  const tokenHash = await sha(token);
  const row = await env.DB.prepare(
    "SELECT * FROM nodes WHERE token_hash = ? AND archived = 0",
  )
    .bind(tokenHash)
    .first<Row>();
  if (!row) throw new HttpError(401, "探针密钥无效或节点已归档");
  const { effective: config } = await settings(env);
  const now = nowSeconds();
  const minInterval = Math.floor(config.reportInterval * 0.95);
  if (row.last_seen > now - minInterval)
    return json(
      { error: "上报过于频繁", interval: config.reportInterval },
      429,
      { "Retry-After": String(config.reportInterval) },
    );
  const metrics = validateMetrics(await body(request));
  const saved = JSON.stringify(metrics);
  const updated = await env.DB.prepare(
    "UPDATE nodes SET last_seen = ?, metrics = ? WHERE id = ? AND last_seen <= ? AND token_hash = ? AND archived = 0 RETURNING id",
  )
    .bind(now, saved, row.id, now - minInterval, tokenHash)
    .first();
  if (!updated)
    return json({ error: "稍后重试", interval: config.reportInterval }, 429, {
      "Retry-After": String(config.reportInterval),
    });
  // History is stored once per time bucket, independent of the reporting interval.
  const bucket =
    Math.floor(now / config.historyInterval) * config.historyInterval;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO history (node_id, ts, metrics) VALUES (?, ?, ?)",
  )
    .bind(row.id, bucket, saved)
    .run();
  return json({ ok: true, interval: config.reportInterval, serverTime: now });
}
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (method !== "GET" && path !== "/api/agent/report") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin)
      throw new HttpError(403, "请求来源不允许");
    if (request.headers.get("Sec-Fetch-Site") === "cross-site")
      throw new HttpError(403, "请求来源不允许");
  }
  if (path === "/api/agent/report" && method === "POST")
    return ingest(request, env);
  if (path === "/api/login" && method === "POST") return login(request, env);
  if (path === "/api/logout" && method === "POST")
    return json({ ok: true }, 200, { "Set-Cookie": cookie(request, "", 0) });
  const admin = await isAdmin(request, env);
  if (path === "/api/session" && method === "GET")
    return json({
      admin,
      configured: Boolean(env.ADMIN_PASSWORD && env.SESSION_SECRET),
    });
  if (path.startsWith("/api/admin/") && !admin)
    throw new HttpError(401, "请先登录管理员账号");
  const { configured, effective: config } = await settings(env);
  if (path === "/api/visitor" && method === "GET") {
    // Echoed straight back to the caller from Cloudflare's own request
    // metadata. Nothing here is logged or persisted.
    const cf = (request as { cf?: Record<string, unknown> }).cf ?? {};
    const text = (value: unknown) =>
      typeof value === "string" && value.trim() ? value.trim() : "";
    return json(
      {
        ip: request.headers.get("CF-Connecting-IP") || "",
        country: text(cf.country),
        city: text(cf.city),
        isp: text(cf.asOrganization),
        asn: typeof cf.asn === "number" ? cf.asn : null,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  }
  if (path === "/api/site" && method === "GET")
    return json({
      siteName: config.siteName,
      description: config.description,
      logoUrl: config.logoUrl,
      public: config.public,
    });
  if (!path.startsWith("/api/admin/") && !config.public && !admin)
    throw new HttpError(401, "此站点仅管理员可访问");
  if (path === "/api/nodes" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM nodes WHERE archived = 0 AND visible = 1 ORDER BY id",
    ).all<Row>();
    return json({
      privacy: "status-only",
      nodes: await publicFleetNodes(results, config, env),
      interval: 120,
    });
  }
  if (path === "/api/admin/overview" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM nodes WHERE archived = 0 ORDER BY sort_order, created_at",
    ).all<Row>();
    const span = config.historyInterval * RECENT_SAMPLES * 3;
    const { results: samples } = await env.DB.prepare(
      `SELECT node_id, ts, metrics FROM (
         SELECT node_id, ts, metrics,
                ROW_NUMBER() OVER (PARTITION BY node_id ORDER BY ts DESC) AS rn
         FROM history WHERE ts >= ?
       ) WHERE rn <= ? ORDER BY node_id, ts`,
    )
      .bind(nowSeconds() - span, RECENT_SAMPLES)
      .all<{ node_id: string; ts: number; metrics: string }>();
    const recent: Record<string, RecentSample[]> = {};
    for (const row of samples) {
      const m = JSON.parse(row.metrics) as Metrics;
      (recent[row.node_id] ||= []).push({
        ts: row.ts,
        latencyMs: m.latencyMs,
        lossPercent: m.lossPercent,
        uploadRate: m.uploadRate,
        downloadRate: m.downloadRate,
      });
    }
    return json({
      nodes: results.map((row) => serializeAdminNode(row, config)),
      recent,
      serverTime: nowSeconds(),
      interval: config.reportInterval,
      offlineAfter: config.offlineAfter,
    });
  }
  const historyMatch = path.match(/^\/api\/nodes\/([a-f\d-]{36})\/history$/);
  if (historyMatch && method === "GET") {
    if (!admin) throw new HttpError(401, "节点历史指标仅管理员可查看");
    const node = await getNode(env, historyMatch[1]);
    if (node.archived) throw new HttpError(404, "节点不存在");
    const hours = Number(url.searchParams.get("hours") || "24");
    if (![1, 6, 24, 168, 720].includes(hours))
      throw new HttpError(400, "历史时间范围无效");
    const since =
      nowSeconds() - Math.min(hours * 3600, config.retentionDays * 86400);
    const bucket = Math.max(
      config.historyInterval,
      Math.ceil((hours * 3600) / 240),
    );
    const { results } = await env.DB.prepare(
      "SELECT ts, metrics FROM history WHERE node_id = ? AND ts >= ? AND ts IN (SELECT MAX(ts) FROM history WHERE node_id = ? AND ts >= ? GROUP BY CAST(ts / ? AS INTEGER)) ORDER BY ts",
    )
      .bind(node.id, since, node.id, since, bucket)
      .all<{ ts: number; metrics: string }>();
    return json({
      points: results.map((row) => ({
        ts: row.ts,
        metrics: JSON.parse(row.metrics),
      })),
      interval: bucket,
    });
  }
  if (path === "/api/admin/settings" && method === "GET")
    return json({
      settings: configured,
      effective: config,
      telegramConfigured: Boolean(
        env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID,
      ),
    });
  if (path === "/api/admin/settings" && method === "PUT") {
    const validated = validateSettings(await body(request));
    await env.DB.prepare(
      "UPDATE settings SET value = json_set(?, '$._activeNodes', (SELECT COUNT(*) FROM nodes WHERE archived = 0)) WHERE id = 1",
    )
      .bind(JSON.stringify(validated))
      .run();
    return json({
      settings: validated,
      effective: (await settings(env)).effective,
    });
  }
  if (path === "/api/admin/nodes" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM nodes ORDER BY archived, sort_order, created_at",
    ).all<Row>();
    return json({
      nodes: results.map((row) => serializeAdminNode(row, config)),
      serverTime: nowSeconds(),
      interval: config.reportInterval,
      offlineAfter: config.offlineAfter,
    });
  }
  const statusMatch = path.match(
    /^\/api\/admin\/nodes\/([a-f\d-]{36})\/status$/,
  );
  if (statusMatch && method === "GET") {
    const node = await getNode(env, statusMatch[1]);
    return json({
      node: serializeAdminNode(node, config),
      serverTime: nowSeconds(),
      interval: config.reportInterval,
      offlineAfter: config.offlineAfter,
    });
  }
  if (path === "/api/admin/nodes" && method === "POST") {
    const n = validateNode(await body(request));
    const id = crypto.randomUUID();
    const token = `cvm_${hex(crypto.getRandomValues(new Uint8Array(32)).buffer)}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO nodes (id, token_hash, name, region, group_name, visible, sort_order, price, currency, billing_cycle, expires_at, notes, created_at, latitude, longitude, location, traffic_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        id,
        await sha(token),
        n.name,
        n.region,
        n.group,
        Number(n.visible),
        n.sortOrder,
        n.price,
        n.currency,
        n.billingCycle,
        n.expiresAt,
        n.notes,
        nowSeconds(),
        n.latitude,
        n.longitude,
        n.location,
        n.trafficLimit,
      ),
      fleetCountStatement(env),
    ]);
    return json(
      { node: serializeAdminNode(await getNode(env, id), config), token },
      201,
    );
  }
  const nodeMatch = path.match(
    /^\/api\/admin\/nodes\/([a-f\d-]{36})(?:\/(rotate-token|archive|restore))?$/,
  );
  if (nodeMatch) {
    const [, id, action] = nodeMatch;
    await getNode(env, id);
    if (method === "PUT" && !action) {
      const n = validateNode(await body(request));
      await env.DB.prepare(
        "UPDATE nodes SET name = ?, region = ?, group_name = ?, visible = ?, sort_order = ?, price = ?, currency = ?, billing_cycle = ?, expires_at = ?, notes = ?, latitude = ?, longitude = ?, location = ?, traffic_limit = ? WHERE id = ?",
      )
        .bind(
          n.name,
          n.region,
          n.group,
          Number(n.visible),
          n.sortOrder,
          n.price,
          n.currency,
          n.billingCycle,
          n.expiresAt,
          n.notes,
          n.latitude,
          n.longitude,
          n.location,
          n.trafficLimit,
          id,
        )
        .run();
      return json({ node: serializeAdminNode(await getNode(env, id), config) });
    }
    if (method === "POST" && action === "rotate-token") {
      const token = `cvm_${hex(crypto.getRandomValues(new Uint8Array(32)).buffer)}`;
      await env.DB.prepare("UPDATE nodes SET token_hash = ? WHERE id = ?")
        .bind(await sha(token), id)
        .run();
      return json({ token });
    }
    if (method === "POST" && (action === "archive" || action === "restore")) {
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE nodes SET archived = ?, last_seen = 0, metrics = NULL, alert_state = ? WHERE id = ?",
        ).bind(Number(action === "archive"), "[]", id),
        fleetCountStatement(env),
      ]);
      return json({ ok: true });
    }
  }
  if (path === "/api/admin/events" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT e.*, n.name FROM events e JOIN nodes n ON n.id = e.node_id ORDER BY e.created_at DESC LIMIT 100",
    ).all();
    return json({ events: results });
  }
  if (path === "/api/admin/export" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM nodes ORDER BY sort_order",
    ).all<Row>();
    return json({
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: configured,
      nodes: results.map((row) => serializeAdminNode(row, config)),
    });
  }
  throw new HttpError(404, "接口不存在");
}

export function nodeAlerts(
  row: Pick<Row, "last_seen" | "metrics" | "expires_at">,
  config: Settings,
  now: number,
): string[] {
  const alerts: string[] = [];
  if (row.last_seen > 0 && now - row.last_seen > config.offlineAfter)
    alerts.push("offline");
  if (
    row.metrics &&
    row.last_seen > 0 &&
    now - row.last_seen <= config.offlineAfter
  ) {
    const m = JSON.parse(row.metrics) as Metrics;
    if (m.cpu >= config.cpuThreshold) alerts.push("cpu");
    if ((m.memoryUsed / m.memoryTotal) * 100 >= config.memoryThreshold)
      alerts.push("memory");
    if ((m.diskUsed / m.diskTotal) * 100 >= config.diskThreshold)
      alerts.push("disk");
  }
  if (
    row.expires_at &&
    Date.parse(`${row.expires_at}T23:59:59Z`) / 1000 - now <=
      config.expiryDays * 86400
  )
    alerts.push("expiry");
  return alerts;
}
const alertLabels: Record<string, string> = {
  offline: "节点离线",
  cpu: "CPU 超过阈值",
  memory: "内存超过阈值",
  disk: "磁盘超过阈值",
  expiry: "节点即将到期或已到期",
};
export async function maintenance(env: Env) {
  const { effective: config } = await settings(env);
  const now = nowSeconds();
  const { results: nodes } = await env.DB.prepare(
    "SELECT id, last_seen, metrics, expires_at, alert_state FROM nodes WHERE archived = 0",
  ).all<Row>();
  // Cleanup is indexed and bounded, including after retention is reduced.
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM login_limits WHERE key IN (SELECT key FROM login_limits WHERE expires_at < ? ORDER BY expires_at LIMIT 200)",
    ).bind(now),
    env.DB.prepare(
      "DELETE FROM events WHERE id IN (SELECT id FROM events WHERE created_at < ? ORDER BY created_at LIMIT 200)",
    ).bind(now - 30 * 86400),
    env.DB.prepare(
      "DELETE FROM history WHERE (node_id, ts) IN (SELECT node_id, ts FROM history WHERE ts < ? ORDER BY ts LIMIT 500)",
    ).bind(now - config.retentionDays * 86400),
  ]);
  const changes: {
    id: string;
    previous: string;
    next: string;
    eventId: string;
    kind: string;
    message: string;
  }[] = [];
  for (const row of nodes) {
    const next = config.alertsEnabled ? nodeAlerts(row, config, now) : [];
    const previous = JSON.parse(row.alert_state) as string[];
    if (JSON.stringify(next) === row.alert_state) continue;
    const added = next.filter((x) => !previous.includes(x));
    const resolved = previous.filter((x) => !next.includes(x));
    const message = [
      added.map((x) => alertLabels[x]).join("、"),
      resolved.length
        ? `已解除：${resolved.map((x) => alertLabels[x]).join("、")}`
        : "",
    ]
      .filter(Boolean)
      .join("；");
    changes.push({
      id: row.id,
      previous: row.alert_state,
      next: JSON.stringify(next),
      eventId: crypto.randomUUID(),
      kind: added.length ? "warning" : "recovery",
      message,
    });
  }
  if (changes.length) {
    const payload = JSON.stringify(changes);
    const statements: D1PreparedStatement[] = [];
    // Two set-based queries keep fleet-wide transitions below Free's 50-query cap.
    // Event creation and state changes commit together and recheck the prior state.
    if (config.alertsEnabled)
      statements.push(
        env.DB.prepare(
          "INSERT INTO events (id, node_id, kind, message, created_at) SELECT json_extract(c.value, '$.eventId'), n.id, json_extract(c.value, '$.kind'), json_extract(c.value, '$.message'), ? FROM json_each(?) c JOIN nodes n ON n.id = json_extract(c.value, '$.id') WHERE n.archived = 0 AND n.alert_state = json_extract(c.value, '$.previous')",
        ).bind(now, payload),
      );
    statements.push(
      env.DB.prepare(
        "UPDATE nodes SET alert_state = json_extract(c.value, '$.next') FROM json_each(?) c WHERE nodes.id = json_extract(c.value, '$.id') AND nodes.archived = 0 AND nodes.alert_state = json_extract(c.value, '$.previous')",
      ).bind(payload),
    );
    await env.DB.batch(statements);
  }
  if (!config.alertsEnabled || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID)
    return;
  const { results: pending } = await env.DB.prepare(
    "SELECT e.id, e.message, n.name FROM events e JOIN nodes n ON n.id = e.node_id WHERE e.delivered = 0 AND e.created_at > ? AND n.archived = 0 ORDER BY e.created_at LIMIT 5",
  )
    .bind(now - 86400)
    .all<{ id: string; message: string; name: string }>();
  for (const event of pending) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text: `${config.siteName}\n${event.name}\n${event.message}`,
          }),
          signal: AbortSignal.timeout(8000),
        },
      );
      const payload = (await response.json()) as { ok?: boolean };
      if (response.ok && payload.ok)
        await env.DB.prepare("UPDATE events SET delivered = 1 WHERE id = ?")
          .bind(event.id)
          .run();
    } catch {
      console.error("Notification delivery failed; queued for retry.");
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !local) {
      if (request.method !== "GET" && request.method !== "HEAD")
        return json({ error: "请使用 HTTPS 加密连接" }, 426);
      url.protocol = "https:";
      return Response.redirect(url.toString(), 308);
    }
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof HttpError)
        return json({ error: error.message }, error.status);
      console.error(
        "API request failed:",
        error instanceof Error ? error.name : "unknown",
      );
      return json({ error: "服务暂时不可用，请检查数据库迁移和额度" }, 503);
    }
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await maintenance(env);
  },
} satisfies ExportedHandler<Env>;
