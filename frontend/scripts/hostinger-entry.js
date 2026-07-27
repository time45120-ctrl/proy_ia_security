process.env.HOSTNAME = "0.0.0.0";
process.env.PORT = process.env.PORT || "3000";

console.log(
  `AFCR_FRONTEND_BOOT=node:${process.version} pid:${process.pid} ppid:${process.ppid} host:${process.env.HOSTNAME} port:${process.env.PORT}`,
);

process.on("uncaughtException", (error) => {
  console.error("AFCR_FRONTEND_UNCAUGHT_EXCEPTION", error);
});
process.on("unhandledRejection", (error) => {
  console.error("AFCR_FRONTEND_UNHANDLED_REJECTION", error);
});

require("./server.js");
