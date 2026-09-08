import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

mkdirSync("public/flags", { recursive: true });
mkdirSync("licenses", { recursive: true });
for (const code of [
  "CN",
  "HK",
  "TW",
  "JP",
  "SG",
  "US",
  "DE",
  "FR",
  "GB",
  "NL",
  "CA",
  "AU",
  "KR",
  "IN",
  "RU",
]) {
  copyFileSync(
    join("upstream/glassmorphism/public/images/flags", `${code}.svg`),
    join("public/flags", `${code}.svg`),
  );
}
copyFileSync(
  "upstream/glassmorphism/LICENSE",
  "licenses/glassmorphism-MIT.txt",
);
copyFileSync("upstream/komari/LICENSE", "licenses/komari-MIT.txt");
console.log("Copied local region assets and upstream license notices.");
