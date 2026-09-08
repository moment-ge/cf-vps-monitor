import { spawn } from "node:child_process";

const children = [
  spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--port",
      "8787",
      "--test-scheduled",
      "--config",
      "wrangler.jsonc",
    ],
    { stdio: "inherit" },
  ),
  spawn("npx", ["vite"], { stdio: "inherit" }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
for (const child of children) child.on("exit", (code) => stop(code || 0));
