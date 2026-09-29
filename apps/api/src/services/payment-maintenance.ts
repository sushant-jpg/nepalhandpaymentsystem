import { Merchant, Notification, PaymentRequest } from "../models/index.js";
import { emitNotification, emitPayment } from "../lib/realtime.js";

const expirableStates = ["CREATED", "AWAITING_PALM", "CUSTOMER_IDENTIFIED", "RISK_CHECK", "AWAITING_CONFIRMATION", "AWAITING_PIN"] as const;

export async function expireAbandonedPayments(now = new Date()): Promise<number> {
  const candidates = await PaymentRequest.find({ state: { $in: expirableStates }, expiresAt: { $lte: now } }).select("_id publicId paymentMethod merchantId").limit(500).lean() as unknown as Array<{ _id: unknown; publicId: string; paymentMethod: string; merchantId: unknown }>;
  if (!candidates.length) return 0;
  const result = await PaymentRequest.updateMany(
    { _id: { $in: candidates.map((item) => item._id) }, state: { $in: expirableStates }, expiresAt: { $lte: now } },
    { $set: { state: "EXPIRED" } },
  );
  for (const payment of candidates) {
    emitPayment(payment.publicId, "EXPIRED");
    if (payment.paymentMethod === "QR") {
      const merchant = await Merchant.findById(payment.merchantId)
        .select("userId businessName")
        .lean();
      if (merchant) {
        const notification = await Notification.create({
          userId: merchant.userId,
          type: "QR_PAYMENT_EXPIRED",
          category: "PAYMENT",
          severity: "INFO",
          title: "QR payment expired",
          message: `Payment request ${payment.publicId} expired without payment.`,
          metadata: { paymentId: payment.publicId },
        });
        emitNotification(merchant.userId.toString(), notification.toObject());
      }
    }
  }
  return result.modifiedCount;
}
