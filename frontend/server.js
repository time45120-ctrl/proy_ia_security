const { createServer } = require("node:http");
const next = require("next");

const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((request, response) => {
    const requestHost = String(request.headers.host || "")
      .split(":")[0]
      .toLowerCase();

    if (requestHost === "www.afcrtecnologia.com") {
      response.writeHead(301, {
        Location: `https://afcrtecnologia.com${request.url || "/"}`,
      });
      response.end();
      return;
    }

    handle(request, response);
  }).listen(port, hostname, () => {
    console.log(`AFCR_FRONTEND_READY=http://${hostname}:${port}`);
  });
});
