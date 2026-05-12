const { createServer } = require("node:http");
const next = require("next");

const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((request, response) => {
    handle(request, response);
  }).listen(port, hostname, () => {
    console.log(`AFCR_FRONTEND_READY=http://${hostname}:${port}`);
  });
});
