import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync, chmodSync } from "node:fs";

if (existsSync(".dev.vars")) {
  console.log("Local secrets already exist. Credentials are in .local-admin.");
} else {
  const password = randomBytes(24).toString("base64url");
  const session = randomBytes(48).toString("base64url");
  writeFileSync(
    ".dev.vars",
    `ADMIN_PASSWORD="${password}"\nSESSION_SECRET="${session}"\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    ".local-admin",
    `Local admin key (development only):\n${password}\n`,
    { mode: 0o600 },
  );
  chmodSync(".dev.vars", 0o600);
  console.log(
    "Generated local secrets. Read .local-admin for the development login key.",
  );
}
