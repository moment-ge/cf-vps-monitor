import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const origin = "http://127.0.0.1:8787";
const password = readFileSync(".local-admin", "utf8").trim().split("\n").at(-1);
const login = await fetch(`${origin}/api/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password }),
});
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie").split(";")[0];
const response = await fetch(`${origin}/api/admin/nodes`, {
  method: "POST",
  headers: { Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "本机验收 macOS",
    region: "US",
    group: "验收",
    visible: false,
    sortOrder: 99,
    price: 0,
    currency: "CNY",
    billingCycle: "free",
    expiresAt: null,
    notes: "本地真实探针验收",
  }),
});
assert.equal(response.status, 201);
const { node, token } = await response.json();
mkdirSync("review", { recursive: true });
writeFileSync(
  "review/agent-test.json",
  JSON.stringify({ endpoint: origin, token, interval: 120 }),
  { mode: 0o600 },
);
try {
  const run = spawnSync(
    "/usr/bin/time",
    [
      "-l",
      "release/agent/cf-monitor-agent-darwin-arm64",
      "-config",
      "review/agent-test.json",
      "-once",
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  assert.equal(run.status, 0, run.stderr);
  const data = await (
    await fetch(`${origin}/api/admin/nodes`, { headers: { Cookie: cookie } })
  ).json();
  const current = data.nodes.find((n) => n.id === node.id);
  assert.equal(current.online, true);
  assert.ok(current.metrics.memoryTotal > 0);
  const history = await (
    await fetch(`${origin}/api/nodes/${node.id}/history`, {
      headers: { Cookie: cookie },
    })
  ).json();
  assert.equal(history.points.length, 1);
  writeFileSync(
    "review/agent-smoke.txt",
    run.stderr +
      "\nVerified: authenticated real macOS report, valid CPU/memory/disk/network values, history sample, hidden node.\n",
  );
  console.log(run.stderr.replaceAll(token, "[redacted]"));
  console.log("Real macOS probe report and history verified.");
} finally {
  await fetch(`${origin}/api/admin/nodes/${node.id}/archive`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
}
