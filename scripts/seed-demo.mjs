import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const now = Math.floor(Date.now() / 1000);
const locations = [
  ["HK", "香港"],
  ["JP", "东京"],
  ["SG", "新加坡"],
  ["US", "洛杉矶"],
  ["DE", "法兰克福"],
  ["NL", "阿姆斯特丹"],
  ["GB", "伦敦"],
  ["FR", "巴黎"],
];
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sql = [
  "UPDATE settings SET value = json_set(value, '$.siteName', '云端观测站', '$.description', '24 台演示节点 · 本地预览', '$.historyInterval', 900, '$._activeNodes', 24) WHERE id = 1;",
];
for (let i = 0; i < 24; i++) {
  const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
  const [region, city] = locations[i % locations.length];
  const name = `${city} ${i < 16 ? "轻量云" : "边缘节点"} ${String(Math.floor(i / 8) + 1).padStart(2, "0")}`;
  const memory = i % 3 === 0 ? 512 * 1024 ** 2 : 1024 ** 3;
  const metrics = {
    os:
      i === 22
        ? "Windows Server 2022"
        : i === 23
          ? "macOS 15.0"
          : i % 2
            ? "Ubuntu 24.04"
            : "Debian 12",
    arch: i % 6 === 0 ? "arm64" : "amd64",
    cpuModel: i % 6 === 0 ? "ARM Neoverse-N1" : "Intel Xeon Processor",
    cpuCores: i > 21 ? 4 : 1,
    cpu: Number((3.2 + ((i * 7.31) % 40)).toFixed(1)),
    memoryUsed: Math.floor(memory * (0.16 + (i % 7) * 0.07)),
    memoryTotal: memory,
    diskUsed: (3 + (i % 12)) * 1024 ** 3,
    diskTotal: 20 * 1024 ** 3,
    uploadRate: 12340 + i * 45989,
    downloadRate: 9230 + i * 2521,
    uploadTotal: (20 + i * 3) * 1024 ** 3,
    downloadTotal: (13 + i * 5) * 1024 ** 3,
    uptime: (3 + i * 2) * 86400,
    latencyMs: 38 + ((i * 13) % 120),
    lossPercent: i % 5 === 0 ? Number(((i % 7) * 0.4).toFixed(1)) : 0,
  };
  // A monthly quota on most nodes; a few stay unmetered.
  const trafficLimit = i % 6 === 5 ? 0 : (i % 3 === 0 ? 20 : 5) * 1024 ** 4;
  const lastSeen = i === 20 ? 0 : i === 6 || i === 13 ? now - 7200 : now;
  const expires = new Date((now + (i < 3 ? 3 + i : 20 + i * 4) * 86400) * 1000)
    .toISOString()
    .slice(0, 10);
  const hash = createHash("sha256").update(randomUUID()).digest("hex");
  sql.push(
    `INSERT OR IGNORE INTO nodes(id, token_hash, name, region, group_name, visible, sort_order, price, currency, billing_cycle, expires_at, notes, created_at, last_seen, metrics, traffic_limit) VALUES (${quote(id)}, ${quote(hash)}, ${quote(name)}, ${quote(region)}, ${quote(i < 16 ? "生产环境" : "备用节点")}, ${i === 23 ? 0 : 1}, ${i}, ${i % 2 ? 15 : 9.9}, 'CNY', 'monthly', ${quote(expires)}, '本地虚构演示节点，不连接真实服务器', ${now - 86400}, ${lastSeen}, ${i === 20 ? "NULL" : quote(JSON.stringify(metrics))}, ${trafficLimit});`,
  );
  if (i === 20) continue;
  for (let p = 0; p < 96; p++) {
    const ts = Math.floor(now / 900) * 900 - (95 - p) * 900;
    const m = {
      ...metrics,
      cpu: Math.max(0, Math.min(100, metrics.cpu + Math.sin(p / 4 + i) * 8)),
      memoryUsed: Math.floor(
        metrics.memoryUsed * (0.96 + Math.sin(p / 9) * 0.04),
      ),
      uploadRate: Math.floor(
        metrics.uploadRate * (0.6 + Math.sin(p / 6) * 0.3),
      ),
      downloadRate: Math.floor(
        metrics.downloadRate * (0.7 + Math.cos(p / 8) * 0.25),
      ),
      latencyMs: Math.max(
        8,
        Math.round(metrics.latencyMs + Math.sin(p / 3 + i) * 26),
      ),
      lossPercent: Math.max(
        0,
        Number((metrics.lossPercent + Math.sin(p / 5 + i) * 1.6).toFixed(1)),
      ),
    };
    sql.push(
      `INSERT OR IGNORE INTO history VALUES (${quote(id)}, ${ts}, ${quote(JSON.stringify(m))});`,
    );
  }
}
const dir = mkdtempSync(join(tmpdir(), "cf-monitor-seed-"));
try {
  const file = join(dir, "demo.sql");
  writeFileSync(file, sql.join("\n"));
  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      "wrangler.jsonc",
      "--file",
      file,
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.status) console.error(result.stderr || result.stdout);
  else console.log("Seeded 24 local demo nodes and their history.");
  process.exitCode = result.status || 0;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
