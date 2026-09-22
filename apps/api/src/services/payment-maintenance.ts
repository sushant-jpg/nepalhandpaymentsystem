import { PaymentRequest } from "../models/index.js";
import { emitPayment } from "../lib/realtime.js";

const expirableStates = ["CREATED", "AWAITING_PALM", "CUSTOMER_IDENTIFIED", "RISK_CHECK", "AWAITING_CONFIRMATION", "AWAITING_PIN"] as const;

export async function expireAbandonedPayments(now = new Date()): Promise<number> {
  const candidates = await PaymentRequest.find({ state: { $in: expirableStates }, expiresAt: { $lte: now } }).select("_id publicId").limit(500).lean() as unknown as Array<{ _id: unknown; publicId: string }>;
  if (!candidates.length) return 0;
  const result = await PaymentRequest.updateMany(
    { _id: { $in: candidates.map((item) => item._id) }, state: { $in: expirableStates }, expiresAt: { $lte: now } },
    { $set: { state: "EXPIRED" } },
  );
  for (const payment of candidates) emitPayment(payment.publicId, "EXPIRED");
  return result.modifiedCount;
}
