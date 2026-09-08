import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["shared/node-state.ts"],
  bundle: true,
  format: "esm",
  write: false,
});
const { nodeIsOnline, probeEndpoint, sampleAge } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

test("pending and archived nodes stay offline, and stale samples expire without a new fetch", () => {
  assert.equal(
    nodeIsOnline({ archived: false, lastSeen: 0 }, 2000, 420),
    false,
  );
  assert.equal(
    nodeIsOnline({ archived: true, lastSeen: 1900 }, 2000, 420),
    false,
  );
  const node = { archived: false, lastSeen: 1000 };
  assert.equal(nodeIsOnline(node, 1420, 420), true);
  assert.equal(nodeIsOnline(node, 1421, 420), false);
  assert.equal(sampleAge(0, 1421), "尚未上报");
  assert.equal(sampleAge(1000, 1421), "7 分钟前");
});
test("VPS enrollment only accepts a deployable HTTPS origin", () => {
  for (const url of [
    "http://127.0.0.1:8790",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://monitor.example/path",
    "https://user:secret@monitor.example",
    "https://monitor.example?token=abc",
  ])
    assert.equal(probeEndpoint(url), null);
  assert.equal(
    probeEndpoint("https://monitor.example/"),
    "https://monitor.example",
  );
});
