import { spawn } from "node:child_process";
import { openSync, closeSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { setTimeout } from "node:timers/promises";
import { resolve } from "node:path";

async function available(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
let port = 8790;
while (port < 8810 && !(await available(port))) port++;
if (port === 8810) throw new Error("No free preview port");
mkdirSync("review", { recursive: true });
const log = openSync("review/preview.log", "a", 0o600);
const child = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--config",
    "wrangler.jsonc",
  ],
  {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      CI: "true",
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_LOG_PATH: resolve("review/wrangler.log"),
    },
  },
);
closeSync(log);
child.unref();
const url = `http://127.0.0.1:${port}`;
for (let i = 0; i < 30; i++) {
  try {
    const response = await fetch(`${url}/api/site`, {
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) {
      writeFileSync(
        "review/preview.json",
        JSON.stringify({ pid: child.pid, url }, null, 2),
      );
      console.log(`Production-build preview ready: ${url}`);
      process.exit(0);
    }
  } catch {}
  await setTimeout(500);
}
try {
  process.kill(-child.pid, "SIGTERM");
} catch {}
throw new Error("Preview did not start. Read review/preview.log.");
