import http from "node:http";
import mongoose from "mongoose";
import { Server } from "socket.io";
import { app } from "./app.js";
import { config } from "./config.js";
import { setSocketServer } from "./lib/realtime.js";

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: config.FRONTEND_URL.split(","), credentials: true } });
setSocketServer(io);

io.on("connection", (socket) => {
  socket.on("payment:watch", (paymentId: unknown) => {
    if (typeof paymentId === "string" && /^NHPR-[A-Z0-9-]+$/.test(paymentId)) socket.join(`payment:${paymentId}`);
  });
});

async function start() {
  await mongoose.connect(config.MONGODB_URI, { autoIndex: config.NODE_ENV !== "production" });
  server.listen(config.PORT, () => {
    console.log(JSON.stringify({ level: "info", message: "Nepal Hand Pay API started", port: config.PORT, environment: config.NODE_ENV }));
  });
}

start().catch((error) => {
  console.error(JSON.stringify({ level: "fatal", message: "API failed to start", error: error instanceof Error ? error.message : "unknown" }));
  process.exit(1);
});

async function shutdown(signal: string) {
  console.log(JSON.stringify({ level: "info", message: "Shutting down", signal }));
  io.close();
  server.close(async () => { await mongoose.disconnect(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
