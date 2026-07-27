const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const standaloneRoot = path.join(projectRoot, ".next", "standalone");

if (!fs.existsSync(path.join(standaloneRoot, "server.js"))) {
  throw new Error("No se genero .next/standalone/server.js.");
}

function copyDirectory(source, destination) {
  if (!fs.existsSync(source)) {
    return;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

copyDirectory(
  path.join(projectRoot, "public"),
  path.join(standaloneRoot, "public"),
);
copyDirectory(
  path.join(projectRoot, ".next", "static"),
  path.join(standaloneRoot, ".next", "static"),
);

console.log("AFCR_FRONTEND_STANDALONE_READY=.next/standalone/server.js");
