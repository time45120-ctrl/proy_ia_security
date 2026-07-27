process.env.HOSTNAME = "0.0.0.0";
process.env.PORT = process.env.PORT || "3000";

const { createServer } = require("node:http");
const next = require("next");
const { config } = require("./.next/required-server-files.json");

const hostname = process.env.HOSTNAME;
const port = Number(process.env.PORT);

console.log(
  `AFCR_FRONTEND_BOOT=node:${process.version} pid:${process.pid} ppid:${process.ppid} host:${hostname} port:${port}`,
);

process.on("uncaughtException", (error) => {
  console.error("AFCR_FRONTEND_UNCAUGHT_EXCEPTION", error);
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error("AFCR_FRONTEND_UNHANDLED_REJECTION", error);
  process.exit(1);
});

const app = next({
  conf: config,
  dev: false,
  dir: __dirname,
  hostname,
  port,
});
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    console.log("AFCR_FRONTEND_PREPARED=1");

    const server = createServer((request, response) => {
      handle(request, response).catch((error) => {
        console.error("AFCR_FRONTEND_REQUEST_ERROR", error);
        if (!response.headersSent) {
          response.statusCode = 500;
        }
        response.end("Internal Server Error");
      });
    });

    server.on("error", (error) => {
      console.error("AFCR_FRONTEND_LISTEN_ERROR", error);
      process.exit(1);
    });

    server.listen(port, hostname, () => {
      console.log(`AFCR_FRONTEND_READY=http://${hostname}:${port}`);
    });
  })
  .catch((error) => {
    console.error("AFCR_FRONTEND_PREPARE_ERROR", error);
    process.exit(1);
  });
