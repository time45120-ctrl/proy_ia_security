const fs = require("node:fs");
const path = require("node:path");

const nextDir = path.join(__dirname, "..", ".next");

fs.rmSync(nextDir, { force: true, recursive: true });
console.log("AFCR_FRONTEND_DEV_CACHE_CLEAN=.next");
