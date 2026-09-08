import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const compiled = await build({
  entryPoints: ["src/node-route.ts"],
  bundle: true,
  format: "esm",
  write: false,
});
const { nodeIdFromPath, nodeDetailHref, isLocalNavigation } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);
test("detail URLs round-trip node IDs and tolerate trailing slashes", () => {
  for (const id of ["00000000-0000-4000-8000-000000000001", "东京 node/#?"]) {
    assert.equal(nodeIdFromPath(nodeDetailHref(id)), id);
    assert.equal(nodeIdFromPath(nodeDetailHref(id) + "/"), id);
  }
});
test("unrelated and malformed URLs cannot crash the dashboard", () => {
  for (const path of [
    "/",
    "/nodes",
    "/nodes/",
    "/nodes/id/history",
    "/nodes/%E0%A4",
  ])
    assert.equal(nodeIdFromPath(path), null);
});
test("links preserve browser gestures for new tabs and ignore already handled clicks", () => {
  const click = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  };
  assert.equal(isLocalNavigation(click), true);
  for (const key of [
    "metaKey",
    "ctrlKey",
    "shiftKey",
    "altKey",
    "defaultPrevented",
  ])
    assert.equal(isLocalNavigation({ ...click, [key]: true }), false);
  assert.equal(isLocalNavigation({ ...click, button: 1 }), false);
});
