import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { fromPaisa } from "../lib/money.js";
import { Transaction, Wallet } from "../models/index.js";

const router = Router();
router.use(authenticate, authorize("CUSTOMER"));

router.get("/customer-dashboard", asyncHandler(async (req, res) => {
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const month = new Date(day.getFullYear(), day.getMonth(), 1);
  const [wallet, today, monthly, recent] = await Promise.all([
    Wallet.findOne({ ownerType: "CUSTOMER", ownerId: req.auth!.userId }).lean(),
    Transaction.aggregate([{ $match: { customerId: new (await import("mongoose")).default.Types.ObjectId(req.auth!.userId), status: "SUCCESS", createdAt: { $gte: day } } }, { $group: { _id: null, value: { $sum: "$amountPaisa" } } }]),
    Transaction.aggregate([{ $match: { customerId: new (await import("mongoose")).default.Types.ObjectId(req.auth!.userId), status: "SUCCESS", createdAt: { $gte: month } } }, { $group: { _id: null, value: { $sum: "$amountPaisa" } } }]),
    Transaction.find({ customerId: req.auth!.userId }).populate("merchantId", "businessName").sort({ createdAt: -1 }).limit(6).lean(),
  ]);
  res.json({ success: true, data: { balance: fromPaisa((wallet as any)?.balancePaisa ?? 0), walletStatus: (wallet as any)?.status, todaySpending: fromPaisa(today[0]?.value ?? 0), monthlySpending: fromPaisa(monthly[0]?.value ?? 0), recent: recent.map((x: any) => ({ transactionId: x.transactionId, merchantName: x.merchantId?.businessName, amount: fromPaisa(x.amountPaisa), status: x.status, createdAt: x.createdAt })) } });
}));

export default router;
