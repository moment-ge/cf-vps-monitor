import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parse } from "jsonc-parser";

const id = process.argv[2];
if (
  !id ||
  !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ||
  id === "00000000-0000-0000-0000-000000000000"
) {
  console.error("Usage: node scripts/prepare-deploy.mjs REAL_D1_DATABASE_ID");
  process.exit(1);
}
const errors = [];
const config = parse(readFileSync("wrangler.jsonc", "utf8"), errors, { allowTrailingComma: true });
if (errors.length) throw new Error('Invalid wrangler.jsonc');
config.d1_databases[0].database_id = id;
writeFileSync("wrangler.jsonc", JSON.stringify(config, null, 2) + "\n");
if (!existsSync(".production-secrets.json")) {
  writeFileSync(
    ".production-secrets.json",
    JSON.stringify(
      {
        ADMIN_PASSWORD: randomBytes(32).toString("base64url"),
        SESSION_SECRET: randomBytes(48).toString("base64url"),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
}
console.log(
  "D1 binding configured. Production keys are in .production-secrets.json (keep private).",
);
