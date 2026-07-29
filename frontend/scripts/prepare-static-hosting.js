const { copyFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");

const source = join(__dirname, "..", "public", ".htaccess");
const destination = join(__dirname, "..", "out", ".htaccess");

if (!existsSync(source)) {
  throw new Error("AFCR_FRONTEND_HOSTINGER_CONFIG_MISSING=public/.htaccess");
}

if (!existsSync(join(__dirname, "..", "out"))) {
  throw new Error("AFCR_FRONTEND_EXPORT_MISSING=out");
}

copyFileSync(source, destination);
console.log("AFCR_FRONTEND_HOSTINGER_CONFIG=out/.htaccess");
