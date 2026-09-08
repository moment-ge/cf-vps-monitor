import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const compiled = await build({
  entryPoints: ["src/map-model.ts"],
  bundle: true,
  format: "esm",
  write: false,
});
const { locationStatus, mapConnections, mapNodeStatus } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);
const healthy = { id: "healthy", online: true, lastSeen: 1 };
const warning = { id: "warning", online: true, lastSeen: 1 };
const offline = { id: "offline", online: false, lastSeen: 1 };
const pending = { id: "pending", online: false, lastSeen: 0 };
const levels = new Map([
  ["healthy", "online"],
  ["warning", "warning"],
  ["offline", "offline"],
  ["pending", "pending"],
]);
const location = (key, nodes) => ({ key, nodes, latitude: 0, longitude: 0 });
test("mixed groups retain offline and online-warning signals instead of hiding them behind healthy peers", () => {
  assert.equal(
    locationStatus(location("mixed", [healthy, offline]), levels),
    "offline",
  );
  assert.equal(
    locationStatus(location("mixed", [healthy, warning]), levels),
    "warning",
  );
  assert.equal(
    locationStatus(location("pending", [pending]), levels),
    "pending",
  );
  assert.equal(mapNodeStatus(pending, new Map()), "pending");
});
test("offline and warning regions retain status routes, including when selected as origin", () => {
  const locations = [
    location("healthy", [healthy]),
    location("warning", [warning]),
    location("offline", [offline]),
    location("pending", [pending]),
  ];
  const routes = mapConnections(locations, "healthy", levels);
  assert.equal(
    routes.find((r) => r.destination.key === "offline").status,
    "offline",
  );
  assert.equal(
    routes.find((r) => r.destination.key === "warning").status,
    "warning",
  );
  assert.equal(
    routes.find((r) => r.destination.key === "pending").status,
    "pending",
  );
  const fromOffline = mapConnections(locations, "offline", levels);
  assert.equal(fromOffline.length, 3);
  assert.equal(
    fromOffline.find((r) => r.destination.key === "healthy").status,
    "offline",
  );
});
test("empty and single-location fleets do not invent connections; stale selection falls back to a real region", () => {
  assert.deepEqual(mapConnections([], "", levels), []);
  assert.deepEqual(
    mapConnections([location("only", [healthy])], "", levels),
    [],
  );
  const routes = mapConnections(
    [location("a", [healthy]), location("b", [offline])],
    "removed",
    levels,
  );
  assert.equal(routes[0].origin.key, "a");
});

test("3D status routes stay above the globe even between antipodes, and signals move without rotation", async () => {
  const sceneBuild = await build({
    entryPoints: ["src/MapScene.ts"],
    bundle: true,
    format: "esm",
    write: false,
  });
  const { buildDistributionLayer } = await import(
    `data:text/javascript;base64,${Buffer.from(sceneBuild.outputFiles[0].text).toString("base64")}`
  );
  const layer = buildDistributionLayer(true);
  layer.update(
    [
      { ...location("origin", [healthy]), latitude: 0, longitude: 0 },
      { ...location("antipode", [offline]), latitude: 0, longitude: 180 },
    ],
    "origin",
    levels,
  );
  const line = layer.group.children.find((child) => child.isLine);
  const positions = line.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const radius = Math.hypot(
      positions.getX(i),
      positions.getY(i),
      positions.getZ(i),
    );
    assert.ok(Number.isFinite(radius) && radius > 1.01);
  }
  const signal = layer.group.children.find((child) => child.isMesh);
  layer.tick(0);
  const before = signal.position.clone();
  layer.tick(1);
  assert.ok(before.distanceTo(signal.position) > 0.01);
  layer.dispose();
  assert.equal(layer.group.children.length, 0);
});
