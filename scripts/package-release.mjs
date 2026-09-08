import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parse } from "jsonc-parser";
import { zipSync } from "fflate";

const project = process.cwd();
const stage = mkdtempSync(join(tmpdir(), "cf-vps-release-"));
const root = join(stage, "cf-vps-monitor");
mkdirSync(root);
const paths = [
  "src",
  "worker",
  "shared",
  "migrations",
  "public",
  "docs",
  "licenses",
  "scripts",
  "tests",
  ".github",
  "package.json",
  "package-lock.json",
  "README.md",
  ".gitignore",
  "wrangler.jsonc",
  "tsconfig.json",
  "vite.config.ts",
  "index.html",
];
try {
  for (const path of paths)
    cpSync(join(project, path), join(root, path), { recursive: true });
  cpSync(join(project, "agent"), join(root, "agent"), {
    recursive: true,
    filter: (path) =>
      !["config.json", ".venv", "__pycache__"].includes(basename(path)),
  });
  cpSync(join(project, "release/agent"), join(root, "release/agent"), {
    recursive: true,
  });
  const errors = [];
  const config = parse(readFileSync(join(root, "wrangler.jsonc"), "utf8"), errors, { allowTrailingComma: true });
  if (errors.length) throw new Error('Invalid wrangler.jsonc');
  config.d1_databases[0].database_id = "00000000-0000-0000-0000-000000000000";
  writeFileSync(
    join(root, "wrangler.jsonc"),
    JSON.stringify(config, null, 2) + "\n",
  );
  const archive = resolve("release/cf-vps-monitor-v1.0.0.zip");
  const entries = {};
  function collect(directory, prefix) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const source = join(directory, item.name);
      const name = `${prefix}/${item.name}`;
      if (item.isDirectory()) collect(source, name);
      else entries[name] = readFileSync(source);
    }
  }
  collect(root, 'cf-vps-monitor');
  writeFileSync(archive, zipSync(entries, { level: 6 }));
  {
    const digest = createHash("sha256")
      .update(readFileSync(archive))
      .digest("hex");
    writeFileSync("release/SHA256SUMS", `${digest}  ${basename(archive)}\n`);
    console.log(`Packaged ${archive}`);
  }
} finally {
  rmSync(stage, { recursive: true, force: true });
}
