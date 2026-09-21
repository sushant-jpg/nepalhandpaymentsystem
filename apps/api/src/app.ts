import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { errorHandler, notFound } from "./lib/errors.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import palmRoutes from "./routes/palm.js";
import paymentRoutes from "./routes/payments.js";
import transactionRoutes from "./routes/transactions.js";
import merchantRoutes from "./routes/merchants.js";
import adminRoutes from "./routes/admin.js";
import securityRoutes from "./routes/security.js";
import analyticsRoutes from "./routes/analytics.js";
import healthRoutes from "./routes/health.js";

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: config.FRONTEND_URL.split(",").map((x) => x.trim()), credentials: true, allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"] }));
app.use(express.json({ limit: "6mb" }));
app.use(cookieParser());
app.use(pinoHttp({
  genReqId: (req, res) => {
    const id = req.headers["x-request-id"]?.toString() ?? nanoid();
    res.setHeader("x-request-id", id);
    return id;
  },
  redact: ["req.headers.authorization", "req.headers.cookie", "req.body.password", "req.body.pin", "req.body.image", "req.body.samples", "res.headers.set-cookie"],
}));
app.use((req, _res, next) => { req.requestId = String(req.id); next(); });

const v1 = express.Router();
v1.use("/health", healthRoutes);
v1.use("/auth", authRoutes);
v1.use("/users", userRoutes);
v1.use("/palm", palmRoutes);
v1.use("/payments", paymentRoutes);
v1.use("/transactions", transactionRoutes);
v1.use("/merchants", merchantRoutes);
v1.use("/admin", adminRoutes);
v1.use("/security", securityRoutes);
v1.use("/analytics", analyticsRoutes);
app.use("/api/v1", v1);

app.use(notFound);
app.use(errorHandler);
