const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const standaloneRoot = path.join(projectRoot, ".next", "standalone");
const deploymentRoot = path.join(projectRoot, "dist");

if (!fs.existsSync(path.join(standaloneRoot, "server.js"))) {
  throw new Error("No se genero .next/standalone/server.js.");
}

function copyPath(source, destination) {
  if (!fs.existsSync(source)) {
    return;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

fs.rmSync(deploymentRoot, { force: true, recursive: true });
copyPath(standaloneRoot, deploymentRoot);
copyPath(
  path.join(projectRoot, "public"),
  path.join(deploymentRoot, "public"),
);
copyPath(
  path.join(projectRoot, ".next", "static"),
  path.join(deploymentRoot, ".next", "static"),
);
copyPath(
  path.join(projectRoot, "scripts", "hostinger-entry.js"),
  path.join(deploymentRoot, "hostinger-entry.js"),
);

if (!fs.existsSync(path.join(deploymentRoot, "hostinger-entry.js"))) {
  throw new Error("No se genero dist/hostinger-entry.js.");
}

console.log("AFCR_FRONTEND_STANDALONE_READY=dist/hostinger-entry.js");
