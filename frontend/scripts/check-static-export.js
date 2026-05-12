const { existsSync } = require("node:fs");
const { join } = require("node:path");

const indexPath = join(__dirname, "..", "out", "index.html");

if (!existsSync(indexPath)) {
  console.error("AFCR_FRONTEND_EXPORT_MISSING=out/index.html");
  process.exit(1);
}

console.log("AFCR_FRONTEND_EXPORT_OK=out/index.html");
