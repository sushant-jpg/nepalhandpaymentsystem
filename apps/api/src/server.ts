import http from "node:http";
import mongoose from "mongoose";
import { Server } from "socket.io";
import { app } from "./app.js";
import { config } from "./config.js";
import { setSocketServer } from "./lib/realtime.js";
import { connectRedis, disconnectRedis, isAccessTokenRevoked } from "./lib/redis.js";
import { verifyAccessToken } from "./lib/auth.js";
import { Merchant, PaymentRequest } from "./models/index.js";
import { expireAbandonedPayments } from "./services/payment-maintenance.js";

const server = http.createServer(app);
let maintenanceTimer: NodeJS.Timeout | undefined;
const io = new Server(server, { cors: { origin: config.FRONTEND_URL.split(","), credentials: true } });
setSocketServer(io);

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string") throw new Error("Missing token");
    const payload = verifyAccessToken(token);
    if (payload.type !== "access" || payload.role !== "MERCHANT" || await isAccessTokenRevoked(payload.jti)) throw new Error("Merchant token required");
    socket.data.userId = payload.sub;
    next();
  } catch {
    next(new Error("Authentication required"));
  }
});

io.on("connection", (socket) => {
  socket.on("payment:watch", async (paymentId: unknown) => {
    if (typeof paymentId !== "string" || !/^NHPR-[A-Z0-9-]+$/.test(paymentId)) return;
    const merchant = await Merchant.findOne({ userId: socket.data.userId }).select("_id").lean();
    if (merchant && await PaymentRequest.exists({ publicId: paymentId, merchantId: merchant._id })) socket.join(`payment:${paymentId}`);
  });
});

async function start() {
  await mongoose.connect(config.MONGODB_URI, { autoIndex: config.NODE_ENV !== "production" });
  await connectRedis();
  maintenanceTimer = setInterval(() => {
    void expireAbandonedPayments().then((count) => {
      if (count) console.log(JSON.stringify({ level: "info", message: "Expired abandoned payments", count }));
    }).catch((error) => console.error(JSON.stringify({ level: "error", message: "Payment expiry maintenance failed", error: error instanceof Error ? error.message : "unknown" })));
  }, config.PAYMENT_CLEANUP_INTERVAL_SECONDS * 1000);
  maintenanceTimer.unref();
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
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  io.close();
  server.close(async () => { await Promise.all([mongoose.disconnect(), disconnectRedis()]); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
