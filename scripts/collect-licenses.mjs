import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

mkdirSync("licenses/dependencies", { recursive: true });
function copyNotice(source, destination) {
  if (existsSync(destination)) chmodSync(destination, 0o644);
  copyFileSync(source, destination);
  chmodSync(destination, 0o644);
}
const notices = [];
const goRoot = execFileSync('go', ['env', 'GOROOT'], { encoding: 'utf8' }).trim();
copyNotice(join(goRoot, 'LICENSE'), 'licenses/dependencies/go-runtime.txt');
for (const pkg of [
  "react",
  "react-dom",
  "scheduler",
  "lucide-react",
  "uplot",
  "three",
]) {
  const dir = join("node_modules", pkg);
  const metadata = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const file = ["LICENSE", "LICENSE.txt", "LICENSE.md"].find((name) =>
    existsSync(join(dir, name)),
  );
  if (!file) throw new Error(`Missing license for ${pkg}`);
  copyNotice(join(dir, file), join("licenses/dependencies", `${pkg}.txt`));
  notices.push(
    `${pkg} ${metadata.version} (${metadata.license || "see notice"})`,
  );
}
const list = execFileSync(
  "go",
  ["list", "-m", "-f", "{{.Path}}|{{.Version}}|{{.Dir}}", "all"],
  { cwd: "agent", encoding: "utf8" },
);
for (const row of list.trim().split("\n")) {
  const [name, version, dir] = row.split("|");
  if (!version || !dir) continue;
  const file = ["LICENSE", "LICENSE.txt", "LICENSE.md", "COPYING"].find(
    (file) => existsSync(join(dir, file)),
  );
  if (file) {
    copyNotice(
      join(dir, file),
      join("licenses/dependencies", `${name.replaceAll("/", "_")}.txt`),
    );
    notices.push(`${name} ${version}`);
  }
}
writeFileSync("licenses/DEPENDENCIES.txt", notices.join("\n") + "\n");
console.log(`Collected ${notices.length} dependency notices.`);
