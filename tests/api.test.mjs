import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

let mf, db, cookie, nodeId, token;
const password = "test-admin-key-with-at-least-32-characters";
const node = {
  name: "香港测试节点",
  region: "HK",
  group: "测试",
  visible: true,
  sortOrder: 0,
  price: 10,
  currency: "CNY",
  billingCycle: "monthly",
  expiresAt: null,
  notes: "private note",
};
const metrics = {
  os: "Debian 12",
  arch: "amd64",
  cpuModel: "Test CPU",
  cpuCores: 1,
  cpu: 12.5,
  memoryUsed: 134217728,
  memoryTotal: 536870912,
  diskUsed: 1024,
  diskTotal: 1048576,
  uploadRate: 1024,
  downloadRate: 2048,
  uploadTotal: 10000,
  downloadTotal: 20000,
  uptime: 12345,
  latencyMs: null,
  lossPercent: null,
};
async function request(path, method = "GET", data, auth = false, headers = {}) {
  return mf.dispatchFetch(`http://localhost/api${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(auth ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}
before(async () => {
  const result = await build({
    stdin: {
      contents: `import worker, {maintenance} from './worker/index.ts';
        import {limitedDatabase} from './tests/limited-db.ts';
        export default {async fetch(request, env, ctx) {
          const budget = limitedDatabase(env.DB);
          const bindings = {...env, DB: budget.db};
          const response = new URL(request.url).pathname === '/api/test-cron'
            ? await maintenance(bindings).then(() => new Response('ok'))
            : await worker.fetch(request, bindings, ctx);
          response.headers.set('X-Test-D1-Queries', String(budget.count()));
          return response;
        }}`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
  });
  mf = new Miniflare({
    modules: true,
    script: result.outputFiles[0].text,
    compatibilityDate: "2026-05-15",
    d1Databases: ["DB"],
    bindings: {
      ADMIN_PASSWORD: password,
      SESSION_SECRET: "test-session-secret-with-more-than-32-characters",
    },
  });
  db = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(
      readFileSync(`migrations/${file}`, "utf8").replace(/\n/g, " "),
    );
  }
});
after(async () => {
  await mf?.dispose();
});

test("admin endpoints reject anonymous calls and login rejects foreign origins", async () => {
  assert.equal((await request("/admin/nodes")).status, 401);
  assert.equal(
    (
      await request("/login", "POST", { password }, false, {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/login", "POST", { password: "wrong" })).status,
    401,
  );
  const response = await request("/login", "POST", { password });
  assert.equal(response.status, 200);
  cookie = response.headers.get("Set-Cookie").split(";")[0];
  assert.match(response.headers.get("Set-Cookie"), /HttpOnly/);
  assert.equal((await request("/session", "GET", undefined, true)).status, 200);
});
test("creates nodes with one-time tokens and never exposes notes or hashes publicly", async () => {
  const response = await request("/admin/nodes", "POST", node, true);
  assert.equal(response.status, 201);
  const result = await response.json();
  nodeId = result.node.id;
  token = result.token;
  assert.match(token, /^cvm_/);
  const publicNodes = await (await request("/nodes")).json();
  assert.equal(publicNodes.privacy, "status-only");
  assert.deepEqual(Object.keys(publicNodes.nodes[0]).sort(), [
    "id",
    "name",
    "status",
  ]);
  assert.match(publicNodes.nodes[0].id, /^public-[a-f0-9]{32}$/);
  assert.notEqual(publicNodes.nodes[0].id, nodeId);
  assert.notEqual(publicNodes.nodes[0].name, node.name);
  assert.equal(publicNodes.nodes[0].status, "pending");
  assert.deepEqual(
    await (await request("/nodes", "GET", undefined, true)).json(),
    publicNodes,
  );
  assert.ok(!JSON.stringify(publicNodes).includes(token));
  assert.ok(!JSON.stringify(publicNodes).includes("token_hash"));
});
test("public responses are not cached and anonymous history cannot enumerate nodes", async () => {
  const response = await request("/nodes");
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.equal(response.headers.get("Vary"), "Cookie");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal((await request(`/nodes/${nodeId}/history`)).status, 401);
  assert.equal(
    (await request("/nodes/00000000-0000-4000-8000-000000000000/history"))
      .status,
    401,
  );
});
test("probe validation rejects missing keys and corrupt metrics", async () => {
  assert.equal((await request("/agent/report", "POST", metrics)).status, 401);
  assert.equal(
    (
      await request("/agent/report", "POST", { ...metrics, cpu: 101 }, false, {
        Authorization: `Bearer ${token}`,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/agent/report",
        "POST",
        { ...metrics, memoryUsed: metrics.memoryTotal + 1 },
        false,
        { Authorization: `Bearer ${token}` },
      )
    ).status,
    400,
  );
});
test("enrollment status is admin-only and reports pending until the first authenticated sample", async () => {
  assert.equal((await request(`/admin/nodes/${nodeId}/status`)).status, 401);
  const result = await (
    await request(`/admin/nodes/${nodeId}/status`, "GET", undefined, true)
  ).json();
  assert.equal(result.node.lastSeen, 0);
  assert.equal(result.node.online, false);
  assert.equal(result.node.metrics, null);
  assert.equal(result.interval, 120);
  assert.equal(result.offlineAfter, 420);
  assert.ok(result.serverTime > 0);
  assert.ok(!JSON.stringify(result).includes(token));
});
test("node coordinates validate and persist without inventing locations", async () => {
  const created = await (
    await request(`/admin/nodes/${nodeId}/status`, "GET", undefined, true)
  ).json();
  assert.equal(created.node.latitude, null);
  assert.equal(created.node.longitude, null);
  for (const location of [
    { latitude: 91, longitude: 10 },
    { latitude: 20, longitude: 181 },
    { latitude: 20, longitude: null },
  ]) {
    assert.equal(
      (
        await request(
          `/admin/nodes/${nodeId}`,
          "PUT",
          { ...node, ...location },
          true,
        )
      ).status,
      400,
    );
  }
  const saved = await request(
    `/admin/nodes/${nodeId}`,
    "PUT",
    {
      ...node,
      latitude: 22.3193,
      longitude: 114.1694,
      location: "香港 · 指定位置",
    },
    true,
  );
  assert.equal(saved.status, 200);
  const result = await saved.json();
  assert.equal(result.node.latitude, 22.3193);
  assert.equal(result.node.longitude, 114.1694);
  const publicData = await (await request("/nodes")).json();
  for (const key of [
    "location",
    "latitude",
    "longitude",
    "region",
    "group",
    "metrics",
    "notes",
  ]) {
    assert.equal(Object.hasOwn(publicData.nodes[0], key), false);
  }
  assert.ok(!JSON.stringify(publicData).includes("香港"));
});
test("reporting stores real metrics, throttles repeats and makes history available", async () => {
  const response = await request("/agent/report", "POST", metrics, false, {
    Authorization: `Bearer ${token}`,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).interval, 120);
  assert.equal(
    (
      await request("/agent/report", "POST", metrics, false, {
        Authorization: `Bearer ${token}`,
      })
    ).status,
    429,
  );
  const result = await (await request("/nodes")).json();
  assert.equal(result.nodes[0].status, "online");
  const overview = await (
    await request("/admin/overview", "GET", undefined, true)
  ).json();
  assert.equal(overview.nodes[0].online, true);
  assert.equal(overview.nodes[0].metrics.cpu, 12.5);
  assert.equal((await request("/admin/overview")).status, 401);
  assert.equal(
    (await request(`/nodes/${nodeId}/history?hours=24`)).status,
    401,
  );
  const connected = await (
    await request(`/admin/nodes/${nodeId}/status`, "GET", undefined, true)
  ).json();
  assert.equal(connected.node.online, true);
  assert.equal(connected.node.metrics.memoryTotal, 536870912);
  assert.ok(connected.node.lastSeen > 0);
  const history = await (
    await request(`/nodes/${nodeId}/history?hours=24`, "GET", undefined, true)
  ).json();
  assert.equal(history.points.length, 1);
  assert.equal(
    (
      await request(
        `/nodes/${nodeId}/history?hours=999999`,
        "GET",
        undefined,
        true,
      )
    ).status,
    400,
  );
});
test("hidden nodes are excluded from public lists and direct history access", async () => {
  assert.equal(
    (
      await request(
        `/admin/nodes/${nodeId}`,
        "PUT",
        { ...node, visible: false },
        true,
      )
    ).status,
    200,
  );
  assert.equal((await (await request("/nodes")).json()).nodes.length, 0);
  assert.equal((await request(`/nodes/${nodeId}/history`)).status, 401);
  assert.equal(
    (await request(`/nodes/${nodeId}/history`, "GET", undefined, true)).status,
    200,
  );
  assert.equal(
    (await (await request("/admin/nodes", "GET", undefined, true)).json())
      .nodes[0].notes,
    "private note",
  );
});
test("token rotation and archive revoke probe access, restore starts pending", async () => {
  const r = await (
    await request(
      `/admin/nodes/${nodeId}/rotate-token`,
      "POST",
      undefined,
      true,
    )
  ).json();
  assert.equal(
    (
      await request("/agent/report", "POST", metrics, false, {
        Authorization: `Bearer ${token}`,
      })
    ).status,
    401,
  );
  token = r.token;
  assert.equal(
    (await request(`/admin/nodes/${nodeId}/archive`, "POST", undefined, true))
      .status,
    200,
  );
  assert.equal(
    (
      await request("/agent/report", "POST", metrics, false, {
        Authorization: `Bearer ${token}`,
      })
    ).status,
    401,
  );
  assert.equal(
    (await request(`/admin/nodes/${nodeId}/restore`, "POST", undefined, true))
      .status,
    200,
  );
  assert.equal(
    (await (await request("/admin/nodes", "GET", undefined, true)).json())
      .nodes[0].lastSeen,
    0,
  );
  assert.equal(
    (
      await request("/agent/report", "POST", metrics, false, {
        Authorization: `Bearer ${token}`,
      })
    ).status,
    200,
  );
});
test("private sites enforce access on public API and settings validate timing constraints", async () => {
  const current = (
    await (await request("/admin/settings", "GET", undefined, true)).json()
  ).settings;
  assert.equal(
    (
      await request(
        "/admin/settings",
        "PUT",
        { ...current, reportInterval: 300, offlineAfter: 180 },
        true,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/admin/settings",
        "PUT",
        { ...current, public: false },
        true,
      )
    ).status,
    200,
  );
  assert.equal((await request("/nodes")).status, 401);
  assert.equal((await request("/nodes", "GET", undefined, true)).status, 200);
  assert.equal((await request("/site")).status, 200);
});
test("scheduled alerts deduplicate, record recovery and clean old history", async () => {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare("UPDATE nodes SET last_seen = ? WHERE id = ?")
    .bind(now - 1000, nodeId)
    .run();
  await db
    .prepare("INSERT INTO history VALUES (?, ?, ?)")
    .bind(nodeId, now - 40 * 86400, JSON.stringify(metrics))
    .run();
  assert.equal((await request("/test-cron")).status, 200);
  assert.equal((await request("/test-cron")).status, 200);
  let events = (
    await (await request("/admin/events", "GET", undefined, true)).json()
  ).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "warning");
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM history WHERE ts < ?")
        .bind(now - 7 * 86400)
        .first()
    ).n,
    0,
  );
  await db
    .prepare("UPDATE nodes SET last_seen = ? WHERE id = ?")
    .bind(now, nodeId)
    .run();
  await request("/test-cron");
  events = (
    await (await request("/admin/events", "GET", undefined, true)).json()
  ).events;
  assert.equal(events.length, 2);
  assert.ok(events.some((e) => e.kind === "recovery"));
});
test("large fleets automatically increase report and history intervals", async () => {
  await db
    .prepare(
      "UPDATE settings SET value = json_set(value, '$._activeNodes', 100) WHERE id = 1",
    )
    .run();
  const result = (
    await (await request("/admin/settings", "GET", undefined, true)).json()
  ).effective;
  assert.ok(result.reportInterval >= 247);
  assert.ok(result.historyInterval >= 1728);
  assert.ok(result.offlineAfter >= result.reportInterval * 3);
});
test("fleet protection preserves configured values and mutations update counts atomically", async () => {
  const current = await (
    await request("/admin/settings", "GET", undefined, true)
  ).json();
  assert.equal(current.settings.reportInterval, 120);
  assert.equal(current.settings.historyInterval, 900);
  const created = await (
    await request(
      "/admin/nodes",
      "POST",
      { ...node, name: "count check" },
      true,
    )
  ).json();
  const count = async () =>
    JSON.parse(
      (await db.prepare("SELECT value FROM settings WHERE id = 1").first())
        .value,
    )._activeNodes;
  assert.equal(await count(), 2);
  await request(
    `/admin/nodes/${created.node.id}/archive`,
    "POST",
    undefined,
    true,
  );
  assert.equal(await count(), 1);
  await request(
    `/admin/nodes/${created.node.id}/restore`,
    "POST",
    undefined,
    true,
  );
  assert.equal(await count(), 2);
  await request(
    `/admin/nodes/${created.node.id}/archive`,
    "POST",
    undefined,
    true,
  );
});
test("login rate limit blocks repeated attempts", async () => {
  for (let i = 0; i < 10; i++)
    await request("/login", "POST", { password: "wrong" }, false, {
      "CF-Connecting-IP": "192.0.2.1",
    });
  assert.equal(
    (
      await request("/login", "POST", { password }, false, {
        "CF-Connecting-IP": "192.0.2.1",
      })
    ).status,
    429,
  );
});
test("100-node fleet returns bounded summaries and runs scheduled maintenance", async () => {
  const now = Math.floor(Date.now() / 1000);
  const statements = Array.from({ length: 100 }, (_, i) =>
    db
      .prepare(
        "INSERT INTO nodes (id, token_hash, name, region, group_name, created_at, last_seen, metrics) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        `load-test-${i}`,
        `Load node ${i}`,
        "US",
        "Load test",
        now,
        now,
        JSON.stringify(metrics),
      ),
  );
  await db.batch(statements);
  await db
    .prepare(
      "UPDATE settings SET value = json_set(value, '$._activeNodes', 101) WHERE id = 1",
    )
    .run();
  const response = await request("/admin/overview", "GET", undefined, true);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(JSON.parse(text).nodes.length, 101);
  assert.ok(
    Buffer.byteLength(text) < 150000,
    "fleet summary should remain compact",
  );
  assert.equal((await request("/test-cron")).status, 200);
});
test("101 simultaneous alerts and recoveries stay below Free D1's query limit", async () => {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      "UPDATE nodes SET last_seen = ?, alert_state = '[]' WHERE archived = 0",
    )
    .bind(now - 10000)
    .run();
  const before = (await db.prepare("SELECT COUNT(*) AS n FROM events").first())
    .n;
  const warning = await request("/test-cron");
  assert.equal(warning.status, 200);
  assert.ok(Number(warning.headers.get("X-Test-D1-Queries")) <= 8);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM events").first()).n,
    before + 101,
  );
  await request("/test-cron");
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM events").first()).n,
    before + 101,
  );
  await db
    .prepare("UPDATE nodes SET last_seen = ? WHERE archived = 0")
    .bind(now)
    .run();
  const recovery = await request("/test-cron");
  assert.equal(recovery.status, 200);
  assert.ok(Number(recovery.headers.get("X-Test-D1-Queries")) <= 8);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM events").first()).n,
    before + 202,
  );
});
test("retention reductions clean a bounded batch and preserve live history", async () => {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      "WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM seq WHERE n < 620) INSERT INTO history SELECT ?, ? - n, ? FROM seq",
    )
    .bind(nodeId, now - 40 * 86400, JSON.stringify(metrics))
    .run();
  const old = async () =>
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM history WHERE ts < ?")
        .bind(now - 7 * 86400)
        .first()
    ).n;
  assert.equal(await old(), 620);
  assert.equal((await request("/test-cron")).status, 200);
  assert.equal(await old(), 120);
  assert.equal((await request("/test-cron")).status, 200);
  assert.equal(await old(), 0);
  assert.ok(
    (await db.prepare("SELECT COUNT(*) AS n FROM history").first()).n > 0,
  );
});
