import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const destination = resolve("release/agent");
mkdirSync(destination, { recursive: true });
const targets = [
  ["linux", "amd64"],
  ["linux", "arm64"],
  ["linux", "386"],
  ["linux", "arm"],
  ["windows", "amd64"],
  ["windows", "arm64"],
  ["darwin", "amd64"],
  ["darwin", "arm64"],
];
const checksums = [];
for (const [os, arch] of targets) {
  const name = `cf-monitor-agent-${os}-${arch}${os === "windows" ? ".exe" : ""}`;
  const file = join(destination, name);
  const result = spawnSync(
    "go",
    ["build", "-trimpath", "-ldflags=-s -w", "-o", file, "."],
    {
      cwd: "agent",
      stdio: "inherit",
      env: {
        ...process.env,
        CGO_ENABLED: "0",
        GOOS: os,
        GOARCH: arch,
        GOARM: "7",
      },
    },
  );
  if (result.status) process.exit(result.status);
  checksums.push(
    `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${name}`,
  );
  console.log(`Built ${name}`);
}
writeFileSync(join(destination, "SHA256SUMS"), checksums.join("\n") + "\n");
